import { sql } from "drizzle-orm";

import type { Db } from "@/db";
import { notFound } from "@/server/errors";

/**
 * The figures behind /admin/analytics.
 *
 * Everything the public progress page shows is in campaign.ts and metrics.ts.
 * What lives here is the part only an administrator has any business seeing:
 * how much of what was promised has actually arrived, how old the unpaid
 * promises are, where pledges came from, and the week by week trend.
 *
 * None of it identifies anybody. These are counts and totals, the same shape
 * of aggregate the public endpoints return, and they are behind a session only
 * because a collections report is an operational document rather than because
 * a row in it could be traced to a person.
 *
 * Money is bigint minor units throughout, per CLAUDE.md. The one figure that
 * is not money is the fulfilment percentage, and it is computed by scaling in
 * bigint and dividing at the very end, so no amount ever passes through a
 * JavaScript number on the way.
 *
 * A figure that cannot be computed is null, never zero, for the reason
 * metrics.ts gives: zero is a real and much worse answer than "not yet".
 */

/**
 * Which pledges an operational report counts.
 *
 * Wider than v_campaign_totals, which counts verified and fulfilled only. A
 * pending pledge is not money promised to the campaign yet and must never
 * reach the public figure, but it is very much something an administrator
 * needs to see ageing in a collections report, because the reason it is still
 * pending may be that nobody has looked at it.
 *
 * Cancelled and void are excluded. Those are promises that no longer exist,
 * and carrying them in an outstanding column would invent a debt.
 *
 * The fulfilment rate does not use this list. It is defined against approved
 * pledges only, so that it answers "of what we have accepted, how much has
 * arrived" rather than mixing in promises nobody has agreed to yet.
 */
const LIVE_STATUSES = sql`('pending', 'verified', 'fulfilled')`;
const APPROVED_STATUSES = sql`('verified', 'fulfilled')`;

async function campaignId(db: Db, campaignSlug: string): Promise<string> {
  const result = await db.execute(sql`
    select id from campaigns where slug = ${campaignSlug} limit 1
  `);
  const row = result.rows[0] as { id: string } | undefined;
  if (!row) {
    throw notFound("campaign_not_found", `No campaign with slug ${campaignSlug}.`);
  }
  return row.id;
}

/* ---------------------------------------------------------------------------
 * Fulfilment rate.
 * ------------------------------------------------------------------------- */

export type Fulfilment = {
  /** Live allocations against approved pledges. */
  allocatedMinor: bigint;
  /** What those approved pledges promised. */
  promisedMinor: bigint;
  /** Allocated over promised, as a percentage. Null when nothing is approved. */
  ratePercent: number | null;
};

/**
 * How much of what was promised has actually been allocated against it.
 *
 * Allocations, not payments. A payment counts toward the campaign total the
 * moment it is recorded, whether or not anybody has matched it to a pledge,
 * and that is right for the public figure. It would be wrong here: the
 * question this answers is whether the promises are being kept, and an
 * unmatched payment says nothing about any particular promise.
 *
 * Reversed allocations are excluded. A correction is a new row in this schema
 * and a reversal leaves the original in place, so counting both would report
 * money against a pledge that has already been taken back off it.
 *
 * The percentage is scaled by 10,000 in bigint and divided once at the end, so
 * the money involved never becomes a float. Two decimal places survive, which
 * is what the card shows.
 */
export async function fulfilment(
  db: Db,
  args: { campaignSlug: string },
): Promise<Fulfilment> {
  const id = await campaignId(db, args.campaignSlug);

  const result = await db.execute(sql`
    select
      (select coalesce(sum(p.amount_minor), 0)
       from pledges p
       where p.campaign_id = ${id}
         and p.status in ${APPROVED_STATUSES}
         and p.deleted_at is null) as promised,
      (select coalesce(sum(a.amount_minor), 0)
       from payment_allocations a
       join pledges p on p.id = a.pledge_id
       where p.campaign_id = ${id}
         and p.status in ${APPROVED_STATUSES}
         and p.deleted_at is null
         and a.reversed_at is null) as allocated
  `);

  const row = result.rows[0] as { promised: string; allocated: string };
  const promisedMinor = BigInt(row.promised);
  const allocatedMinor = BigInt(row.allocated);

  return {
    allocatedMinor,
    promisedMinor,
    ratePercent:
      promisedMinor === 0n
        ? null
        : Number((allocatedMinor * 10_000n) / promisedMinor) / 100,
  };
}

/* ---------------------------------------------------------------------------
 * Outstanding by age.
 * ------------------------------------------------------------------------- */

export const AGEING_BUCKETS = [
  { key: "0-30", label: "0 to 30 days", upperDays: 30 },
  { key: "31-90", label: "31 to 90 days", upperDays: 90 },
  { key: "91-180", label: "91 to 180 days", upperDays: 180 },
  { key: "180+", label: "Over 180 days", upperDays: null },
] as const;

export type AgeingBucketKey = (typeof AGEING_BUCKETS)[number]["key"];

export type AgeingBucket = {
  key: AgeingBucketKey;
  label: string;
  pledgeCount: number;
  outstandingMinor: bigint;
};

export type Ageing = {
  buckets: AgeingBucket[];
  totalPledges: number;
  totalOutstandingMinor: bigint;
};

/**
 * Unpaid pledge balances, bucketed by how long they have been outstanding.
 *
 * Age runs from the pledge's creation, not from its approval. A pledge that
 * sat pending for two months has been outstanding for two months, and dating
 * it from approval would hide exactly the delay this report exists to show.
 *
 * Dates are compared in Africa/Nairobi, matching snapshots.ts. A pledge made
 * at ten at night in Nairobi belongs to that day, and comparing the raw
 * timestamp would file it under the next one and report it a day younger than
 * it is.
 *
 * Only balances with something still owed are counted. A fully paid pledge has
 * an outstanding of zero and belongs in no bucket, and the view already models
 * a reversal correctly, so a reversed allocation puts the amount back into the
 * outstanding column where it belongs.
 *
 * Every bucket is returned whether or not it has rows, so the four cards keep
 * their positions and a reader learns that the 180 day bucket is empty rather
 * than that it is missing.
 */
export async function ageing(
  db: Db,
  args: { campaignSlug: string },
): Promise<Ageing> {
  const id = await campaignId(db, args.campaignSlug);

  const result = await db.execute(sql`
    select case
             when age.days <= 30  then '0-30'
             when age.days <= 90  then '31-90'
             when age.days <= 180 then '91-180'
             else '180+'
           end as bucket,
           count(*) as pledges,
           sum(b.outstanding_minor) as outstanding
    from pledges p
    join v_pledge_balances b on b.pledge_id = p.id
    cross join lateral (
      select current_date - (p.created_at at time zone 'Africa/Nairobi')::date
             as days
    ) age
    where p.campaign_id = ${id}
      and p.status in ${LIVE_STATUSES}
      and b.outstanding_minor > 0
    group by 1
  `);

  const rows = result.rows as {
    bucket: string;
    pledges: string;
    outstanding: string;
  }[];

  const byKey = new Map(rows.map((row) => [row.bucket, row]));

  const buckets = AGEING_BUCKETS.map((bucket) => {
    const row = byKey.get(bucket.key);
    return {
      key: bucket.key,
      label: bucket.label,
      pledgeCount: row ? Number(row.pledges) : 0,
      outstandingMinor: row ? BigInt(row.outstanding) : 0n,
    };
  });

  return {
    buckets,
    totalPledges: buckets.reduce((n, bucket) => n + bucket.pledgeCount, 0),
    totalOutstandingMinor: buckets.reduce(
      (total, bucket) => total + bucket.outstandingMinor,
      0n,
    ),
  };
}

/* ---------------------------------------------------------------------------
 * Channel mix.
 * ------------------------------------------------------------------------- */

/** The channels the pledges_channel_check constraint allows, in this order. */
export const CHANNELS = ["web", "admin", "event", "sms", "import"] as const;

export type Channel = (typeof CHANNELS)[number];

export type ChannelRow = {
  channel: Channel;
  label: string;
  pledgeCount: number;
  totalMinor: bigint;
};

const CHANNEL_LABELS: Record<Channel, string> = {
  web: "Web form",
  admin: "Entered by an admin",
  event: "At an event",
  sms: "SMS",
  import: "Imported",
};

/**
 * Where the pledges came from.
 *
 * Every channel the schema allows is returned, including the ones with nothing
 * in them, because an empty row here is information: it says the event desk
 * has not recorded anything yet, which is a question somebody should ask.
 *
 * Counted over the same live statuses as the ageing report, so the two
 * sections describe the same set of pledges and their counts agree.
 */
export async function channelMix(
  db: Db,
  args: { campaignSlug: string },
): Promise<ChannelRow[]> {
  const id = await campaignId(db, args.campaignSlug);

  const result = await db.execute(sql`
    select p.channel,
           count(*) as pledges,
           coalesce(sum(p.amount_minor), 0) as total
    from pledges p
    where p.campaign_id = ${id}
      and p.status in ${LIVE_STATUSES}
      and p.deleted_at is null
    group by 1
  `);

  const rows = result.rows as {
    channel: string;
    pledges: string;
    total: string;
  }[];

  const byChannel = new Map(rows.map((row) => [row.channel, row]));

  return CHANNELS.map((channel) => {
    const row = byChannel.get(channel);
    return {
      channel,
      label: CHANNEL_LABELS[channel],
      pledgeCount: row ? Number(row.pledges) : 0,
      totalMinor: row ? BigInt(row.total) : 0n,
    };
  });
}

/* ---------------------------------------------------------------------------
 * Weekly trend.
 * ------------------------------------------------------------------------- */

export type WeeklyRow = {
  /** ISO week, for example 2026-W37. */
  isoWeek: string;
  /** The Monday that starts it, as YYYY-MM-DD. */
  weekStart: string;
  newPledges: number;
  newPledgedMinor: bigint;
};

export const TRAILING_WEEKS = 12;

/**
 * New pledging per ISO week over the trailing twelve weeks.
 *
 * The weeks are generated rather than grouped out of the data, and the
 * snapshots are left joined onto them. Grouping the table alone would return
 * only the weeks that happen to have rows, so a quiet fortnight would close up
 * and the chart would show twelve bars that were not twelve consecutive weeks.
 *
 * new_pledged_minor is summed rather than the cumulative column differenced,
 * for the reason metrics.ts gives: a correction that lowers the cumulative
 * figure would otherwise appear as negative pledging in a week nobody pledged
 * less.
 *
 * date_trunc('week') is Monday based in Postgres, which is the ISO week the
 * label names, so the bucket and its name cannot disagree.
 */
export async function weekly(
  db: Db,
  args: { campaignSlug: string; weeks?: number },
): Promise<WeeklyRow[]> {
  const id = await campaignId(db, args.campaignSlug);
  const weeks = args.weeks ?? TRAILING_WEEKS;

  const result = await db.execute(sql`
    with wanted as (
      select (date_trunc('week', current_date)::date - (i * 7)) as week_start
      from generate_series(0, ${weeks - 1}::int) as i
    )
    select to_char(w.week_start, 'IYYY-"W"IW') as iso_week,
           w.week_start,
           coalesce(sum(s.new_pledges), 0) as new_pledges,
           coalesce(sum(s.new_pledged_minor), 0) as new_pledged_minor
    from wanted w
    left join campaign_daily_stats s
           on s.campaign_id = ${id}
          and s.stat_date >= w.week_start
          and s.stat_date < w.week_start + 7
    group by 1, 2
    order by 2
  `);

  return (
    result.rows as {
      iso_week: string;
      week_start: string;
      new_pledges: string;
      new_pledged_minor: string;
    }[]
  ).map((row) => ({
    isoWeek: row.iso_week,
    weekStart: String(row.week_start).slice(0, 10),
    newPledges: Number(row.new_pledges),
    newPledgedMinor: BigInt(row.new_pledged_minor),
  }));
}

/* ---------------------------------------------------------------------------
 * Projection.
 * ------------------------------------------------------------------------- */

export type ProjectedPoint = {
  date: string;
  pledgedMinor: bigint;
};

/**
 * How far ahead a projection is allowed to run: three years of days.
 *
 * At a small enough run rate the target is centuries away, and a dashed line
 * drawn to the year 2400 tells a reader nothing except that the axis is
 * broken. Past this point the honest thing the chart can say is that the line
 * is still climbing and has not got there, so it stops and says that.
 */
export const MAX_PROJECTION_DAYS = 1096;

/**
 * The 12 week run rate, extended forward day by day until it meets the target.
 *
 * Pure, and deliberately so. It takes the last actual point and a rate and
 * returns coordinates, which means it can be checked against a known rate
 * without a database.
 *
 * The first point returned is the last actual one. That is what joins the
 * dashed line to the end of the solid area rather than leaving it floating in
 * space a day to the right.
 *
 * Growth is computed as rate * elapsedDays / 7 from the starting figure rather
 * than by adding a daily rate each step. A weekly rate under seven cents would
 * truncate to a daily rate of zero and project a permanently flat line, and
 * accumulating truncation over a thousand steps would drift regardless.
 *
 * Returns nothing at all when there is no rate, when the rate is zero, or when
 * the target is already met. The brief asks for no line in the first two
 * cases, and in the third there is nothing left to project.
 */
export function projection(args: {
  from: ProjectedPoint;
  weeklyRateMinor: bigint | null;
  targetMinor: bigint;
  maxDays?: number;
}): ProjectedPoint[] {
  const { from, weeklyRateMinor, targetMinor } = args;
  const maxDays = args.maxDays ?? MAX_PROJECTION_DAYS;

  if (weeklyRateMinor === null || weeklyRateMinor <= 0n) return [];
  if (from.pledgedMinor >= targetMinor) return [];

  const start = new Date(`${from.date}T00:00:00Z`);
  const points: ProjectedPoint[] = [{ ...from }];

  for (let day = 1; day <= maxDays; day += 1) {
    const pledgedMinor =
      from.pledgedMinor + (weeklyRateMinor * BigInt(day)) / 7n;

    const at = new Date(start);
    at.setUTCDate(at.getUTCDate() + day);

    points.push({
      date: at.toISOString().slice(0, 10),
      // Clamped, so the dashed line lands on the target line and stops there
      // rather than carrying on above it and stretching the axis.
      pledgedMinor:
        pledgedMinor > targetMinor ? targetMinor : pledgedMinor,
    });

    if (pledgedMinor >= targetMinor) break;
  }

  return points;
}
