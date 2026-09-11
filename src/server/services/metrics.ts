import { sql } from "drizzle-orm";

import type { Db } from "@/db";
import { notFound } from "@/server/errors";

/**
 * Campaign metrics for the progress page.
 *
 * Every figure here is derived from the database at read time. None of it is
 * stored, so none of it can drift from the ledger it describes.
 *
 * All money is bigint minor units and all division is integer division, which
 * truncates. That is the right behaviour for every figure below: an average
 * pledge of "KES 12,499 and a bit" is reported as 12,499, and a run rate is
 * rounded down, so an estimate of when the campaign lands is never optimistic
 * because of rounding.
 *
 * A figure that cannot be computed is null rather than zero. Zero is a real
 * answer that means "nothing is coming in", and a page that cannot tell that
 * apart from "there is not enough data yet" will eventually tell the
 * congregation the wrong thing.
 */

/** The date the campaign is aiming at, from the brief. */
export const TARGET_DATE = "2027-12-31";

export type KeyMetrics = {
  targetMinor: bigint;
  pledgedMinor: bigint;
  receivedMinor: bigint;
  remainingMinor: bigint;
  pledgeCount: number;

  /** Total pledged over the number of pledges. Null when there are none. */
  averagePledgeMinor: bigint | null;
  /** The middle pledge, not the mean. Null when there are none. */
  medianPledgeMinor: bigint | null;

  /** Average weekly pledging over the trailing 4 and 12 weeks. */
  runRate4WeekMinor: bigint | null;
  runRate12WeekMinor: bigint | null;

  /** At the 12 week rate. Null when nothing is coming in, or the target is met. */
  weeksToTarget: number | null;
  monthsToTarget: number | null;

  /** What each month has to bring to land on the target date. */
  requiredMonthlyMinor: bigint | null;
  monthsRemaining: number;
};

type TotalsRow = {
  target_minor: string;
  pledged_minor: string;
  received_minor: string;
  pledge_count: string;
};

/**
 * The sum of new pledging over a trailing window, from the daily snapshots.
 *
 * Reads new_pledged_minor rather than differencing the cumulative column,
 * because a correction that lowers the cumulative figure would otherwise show
 * up as negative pledging in a week nobody pledged less.
 */
async function trailingPledged(
  db: Db,
  id: string,
  days: number,
): Promise<{ sum: bigint; daysCovered: number }> {
  const result = await db.execute(sql`
    select coalesce(sum(new_pledged_minor), 0) as total,
           count(*) as days
    from campaign_daily_stats
    where campaign_id = ${id}
      and stat_date > current_date - ${days}::int
  `);

  const row = result.rows[0] as { total: string; days: string };
  return { sum: BigInt(row.total), daysCovered: Number(row.days) };
}

/**
 * Whole months between now and the target date, floored at one.
 *
 * Floored because dividing by zero in the month the campaign closes would be a
 * crash on the last page anyone looks at, and because "everything still owed,
 * this month" is the honest answer at that point.
 */
function monthsUntil(target: string, from: Date = new Date()): number {
  const end = new Date(`${target}T00:00:00Z`);
  const months =
    (end.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - from.getUTCMonth());
  return Math.max(1, months);
}

export async function keyMetrics(
  db: Db,
  args: { campaignSlug: string; targetDate?: string },
): Promise<KeyMetrics> {
  const campaign = await db.execute(sql`
    select id from campaigns where slug = ${args.campaignSlug} limit 1
  `);
  const found = campaign.rows[0] as { id: string } | undefined;
  if (!found) {
    throw notFound(
      "campaign_not_found",
      `No campaign with slug ${args.campaignSlug}.`,
    );
  }
  const id = found.id;

  const totalsResult = await db.execute(sql`
    select t.target_minor, t.pledged_minor, t.received_minor, t.pledge_count
    from v_campaign_totals t
    where t.campaign_id = ${id}
  `);
  const totals = totalsResult.rows[0] as TotalsRow;

  const targetMinor = BigInt(totals.target_minor);
  const pledgedMinor = BigInt(totals.pledged_minor);
  const receivedMinor = BigInt(totals.received_minor);
  const pledgeCount = Number(totals.pledge_count);
  const remainingMinor =
    targetMinor > pledgedMinor ? targetMinor - pledgedMinor : 0n;

  /*
   * The average and the median both come from the pledges themselves, not from
   * the campaign total.
   *
   * pledged_minor in v_campaign_totals includes the campaign's opening balance,
   * which is money raised before this platform existed and is not a pledge
   * anybody made here. Dividing it by the pledge count reported an average
   * pledge of KES 275,000 for four pledges averaging KES 25,000, because the
   * whole opening balance was being shared out among them.
   *
   * percentile_disc, not percentile_cont. The discrete form returns a pledge
   * amount that somebody actually promised; the continuous form interpolates
   * between two of them and can invent a figure with fractions of a cent in it,
   * which is not a thing this system is allowed to produce.
   */
  const shapeResult = await db.execute(sql`
    select percentile_disc(0.5) within group (order by p.amount_minor) as median,
           coalesce(sum(p.amount_minor), 0) as total,
           count(*) as n
    from pledges p
    where p.campaign_id = ${id}
      and p.status in ('verified', 'fulfilled')
      and p.deleted_at is null
  `);
  const shape = shapeResult.rows[0] as {
    median: string | null;
    total: string;
    n: string;
  };
  const pledgedByPeople = BigInt(shape.total);
  const pledgesMade = Number(shape.n);
  const medianRaw = shape.median;

  const fourWeek = await trailingPledged(db, id, 28);
  const twelveWeek = await trailingPledged(db, id, 84);

  /*
   * A run rate needs a window to have actually elapsed. With three days of
   * history a "four week average" is really a three day total presented as a
   * quarter of what it is, which would flatter the campaign badly. Null until
   * the window is at least mostly covered.
   */
  const runRate4WeekMinor =
    fourWeek.daysCovered >= 14 ? fourWeek.sum / 4n : null;
  const runRate12WeekMinor =
    twelveWeek.daysCovered >= 42 ? twelveWeek.sum / 12n : null;

  // The longer window is the one used for the estimate: it is less swayed by a
  // single large pledge in a quiet fortnight.
  const rateForEstimate = runRate12WeekMinor ?? runRate4WeekMinor;

  let weeksToTarget: number | null = null;
  let monthsToTarget: number | null = null;

  if (remainingMinor === 0n) {
    weeksToTarget = 0;
    monthsToTarget = 0;
  } else if (rateForEstimate && rateForEstimate > 0n) {
    const weeks = remainingMinor / rateForEstimate;
    weeksToTarget = Number(weeks);
    // Rounded up: a campaign landing part way through a month has not finished
    // that month.
    monthsToTarget = Math.ceil(weeksToTarget / (52 / 12));
  }

  const monthsRemaining = monthsUntil(args.targetDate ?? TARGET_DATE);

  return {
    targetMinor,
    pledgedMinor,
    receivedMinor,
    remainingMinor,
    pledgeCount,
    averagePledgeMinor:
      pledgesMade > 0 ? pledgedByPeople / BigInt(pledgesMade) : null,
    medianPledgeMinor: medianRaw === null ? null : BigInt(medianRaw),
    runRate4WeekMinor,
    runRate12WeekMinor,
    weeksToTarget,
    monthsToTarget,
    requiredMonthlyMinor:
      remainingMinor === 0n ? 0n : remainingMinor / BigInt(monthsRemaining),
    monthsRemaining,
  };
}
