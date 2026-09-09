import { sql } from "drizzle-orm";

import type { Db } from "@/db";
import { notFound } from "@/server/errors";

/**
 * The daily campaign snapshot.
 *
 * campaign_daily_stats holds one row per campaign per day. Nothing wrote to it
 * before this file existed, which is why the charts had no history to draw:
 * the table was created on day one so the history would accumulate, and then
 * nothing accumulated it.
 *
 * Two things live here and they compute the same figures.
 *
 * writeSnapshot records the campaign as at one date and is what the daily job
 * calls. backfill writes every date from the first activity to today in one
 * statement, which is how the table gets a past at all.
 *
 * Worth being clear about what a backfilled row is. It is a reconstruction, not
 * a recording. There is no history of status changes in this schema, so a row
 * for last Tuesday is built from the pledges as they stand now, attributed to
 * the dates they were created and paid. A pledge created on Tuesday and
 * approved on Friday therefore appears in Tuesday's row, because approval left
 * no dated trace to place it later. Rows written by the job from now on do not
 * have that problem: each records the state on the day it ran.
 *
 * That is also why the figures here can differ slightly from v_campaign_totals
 * for past dates and must agree exactly for today. The verification checks the
 * second.
 *
 * Money stays bigint throughout. The driver returns these columns as strings
 * and they become BigInt without passing through a JavaScript number.
 */

export type SnapshotRow = {
  statDate: string;
  pledgedMinor: bigint;
  receivedMinor: bigint;
  pledgeCount: number;
  pledgerCount: number;
  newPledges: number;
  newPledgedMinor: bigint;
};

type RawSnapshot = {
  stat_date: string;
  pledged_minor: string;
  received_minor: string;
  pledge_count: string;
  pledger_count: string;
  new_pledges: string;
  new_pledged_minor: string;
};

/** One raw row from the table, as the rest of the app wants it. */
function toSnapshotRow(row: RawSnapshot): SnapshotRow {
  return {
    statDate: String(row.stat_date).slice(0, 10),
    pledgedMinor: BigInt(row.pledged_minor),
    receivedMinor: BigInt(row.received_minor),
    pledgeCount: Number(row.pledge_count),
    pledgerCount: Number(row.pledger_count),
    newPledges: Number(row.new_pledges),
    newPledgedMinor: BigInt(row.new_pledged_minor),
  };
}

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

/**
 * Writes a row for every date in a range, in one statement.
 *
 * One statement and not a loop. The first version of this walked the dates in
 * TypeScript calling a single day insert for each, which is a network round
 * trip per day: 431 days against a remote database took minutes and looked like
 * a hang. generate_series produces the dates inside the query, the lateral
 * joins are evaluated per date, and the whole history lands in one trip.
 *
 * Every figure is "as at the end of stat_date", which is what makes a row
 * comparable with the one before it and what lets the cumulative series be read
 * straight off the table without windowing.
 *
 * Only verified and fulfilled pledges count toward the pledged figure, matching
 * v_campaign_totals exactly. A pending pledge nobody has approved is not money
 * promised to the campaign yet, and the public chart must not say it is.
 *
 * Dates are compared in Africa/Nairobi, not UTC. A pledge made at ten at night
 * in Nairobi belongs to that day, and comparing the raw timestamp would file it
 * under the next one.
 *
 * Idempotent: the upsert is keyed on (campaign_id, stat_date), so running it
 * again over the same range corrects those rows rather than doubling them.
 */
async function writeRange(
  db: Db,
  id: string,
  from: string,
  to: string,
): Promise<number> {
  const result = await db.execute(sql`
    insert into campaign_daily_stats (
      campaign_id, stat_date, pledged_minor, received_minor,
      pledge_count, pledger_count, new_pledges, new_pledged_minor
    )
    select c.id,
           d.stat_date::date,
           c.opening_balance_minor + coalesce(cum.amount, 0),
           c.opening_balance_minor + coalesce(pay.amount, 0),
           coalesce(cum.pledges, 0),
           coalesce(cum.pledgers, 0),
           coalesce(fresh.pledges, 0),
           coalesce(fresh.amount, 0)
    from campaigns c
    cross join lateral generate_series(
      ${from}::date, ${to}::date, interval '1 day'
    ) as d(stat_date)
    left join lateral (
      select sum(p.amount_minor) as amount,
             count(*) as pledges,
             count(distinct p.pledger_id) as pledgers
      from pledges p
      where p.campaign_id = c.id
        and p.status in ('verified', 'fulfilled')
        and (p.created_at at time zone 'Africa/Nairobi')::date <= d.stat_date::date
    ) cum on true
    left join lateral (
      select sum(p.amount_minor) as amount
      from payments p
      where p.campaign_id = c.id
        and p.status = 'received'
        and (p.paid_at at time zone 'Africa/Nairobi')::date <= d.stat_date::date
    ) pay on true
    left join lateral (
      select count(*) as pledges, sum(p.amount_minor) as amount
      from pledges p
      where p.campaign_id = c.id
        and p.status in ('verified', 'fulfilled')
        and (p.created_at at time zone 'Africa/Nairobi')::date = d.stat_date::date
    ) fresh on true
    where c.id = ${id}
    on conflict (campaign_id, stat_date) do update set
      pledged_minor     = excluded.pledged_minor,
      received_minor    = excluded.received_minor,
      pledge_count      = excluded.pledge_count,
      pledger_count     = excluded.pledger_count,
      new_pledges       = excluded.new_pledges,
      new_pledged_minor = excluded.new_pledged_minor
  `);

  return result.rowCount ?? 0;
}

/** Reads one written row back, so the caller sees what landed. */
async function readSnapshot(
  db: Db,
  id: string,
  statDate: string,
): Promise<SnapshotRow> {
  const result = await db.execute(sql`
    select stat_date, pledged_minor, received_minor, pledge_count,
           pledger_count, new_pledges, new_pledged_minor
    from campaign_daily_stats
    where campaign_id = ${id} and stat_date = ${statDate}::date
  `);
  return toSnapshotRow(result.rows[0] as RawSnapshot);
}

/**
 * Records the campaign as at one date. What the daily job calls.
 */
export async function writeSnapshot(
  db: Db,
  args: { campaignSlug: string; statDate: string },
): Promise<SnapshotRow> {
  const id = await campaignId(db, args.campaignSlug);
  await writeRange(db, id, args.statDate, args.statDate);
  return readSnapshot(db, id, args.statDate);
}

/** Today in Nairobi. The campaign's day, not the server's. */
export function today(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });
}

/**
 * The first day the campaign had anything to record.
 *
 * The earliest of the campaign start, the first pledge and the first payment.
 * Starting from the campaign start alone would write a run of identical empty
 * rows for a campaign configured months before it opened, and starting from the
 * first pledge would lose a payment that arrived before it.
 */
async function firstActiveDate(
  db: Db,
  id: string,
): Promise<string | null> {
  const result = await db.execute(sql`
    select least(
             c.starts_on,
             (select min((created_at at time zone 'Africa/Nairobi')::date)
              from pledges where campaign_id = c.id
                and status in ('verified', 'fulfilled')),
             (select min((paid_at at time zone 'Africa/Nairobi')::date)
              from payments where campaign_id = c.id and status = 'received')
           ) as from_date
    from campaigns c
    where c.id = ${id}
  `);

  const row = result.rows[0] as { from_date: string | null } | undefined;
  return row?.from_date ? String(row.from_date).slice(0, 10) : null;
}

export type BackfillResult = {
  from: string | null;
  to: string;
  daysWritten: number;
};

/**
 * Writes a row for every day from the campaign's first activity to today.
 *
 * One statement covering the whole range, so the cost is a single round trip
 * whether that is three days or three years.
 */
export async function backfill(
  db: Db,
  args: { campaignSlug: string },
): Promise<BackfillResult> {
  const id = await campaignId(db, args.campaignSlug);
  const to = today();
  const from = await firstActiveDate(db, id);

  if (!from) return { from: null, to, daysWritten: 0 };

  const daysWritten = await writeRange(db, id, from, to);

  return { from, to, daysWritten };
}

/* ---------------------------------------------------------------------------
 * Reading the history back.
 * ------------------------------------------------------------------------- */

/**
 * The cumulative series, oldest first.
 *
 * Read straight off the table rather than summed with a window function,
 * because every row already holds the cumulative figure as at its own date.
 * That is the whole point of storing it that way.
 */
export async function series(
  db: Db,
  args: { campaignSlug: string; days?: number },
): Promise<SnapshotRow[]> {
  const id = await campaignId(db, args.campaignSlug);

  const result = args.days
    ? await db.execute(sql`
        select * from (
          select stat_date, pledged_minor, received_minor, pledge_count,
                 pledger_count, new_pledges, new_pledged_minor
          from campaign_daily_stats
          where campaign_id = ${id}
          order by stat_date desc
          limit ${args.days}
        ) recent
        order by stat_date
      `)
    : await db.execute(sql`
        select stat_date, pledged_minor, received_minor, pledge_count,
               pledger_count, new_pledges, new_pledged_minor
        from campaign_daily_stats
        where campaign_id = ${id}
        order by stat_date
      `);

  return (result.rows as RawSnapshot[]).map(toSnapshotRow);
}

export type MonthlyRow = {
  /** YYYY-MM. */
  month: string;
  newPledgedMinor: bigint;
  newPledges: number;
};

/** New pledging per calendar month, for the bar chart. */
export async function monthly(
  db: Db,
  args: { campaignSlug: string },
): Promise<MonthlyRow[]> {
  const id = await campaignId(db, args.campaignSlug);

  const result = await db.execute(sql`
    select to_char(date_trunc('month', stat_date), 'YYYY-MM') as month,
           sum(new_pledged_minor) as new_pledged_minor,
           sum(new_pledges) as new_pledges
    from campaign_daily_stats
    where campaign_id = ${id}
    group by 1
    order by 1
  `);

  return (
    result.rows as { month: string; new_pledged_minor: string; new_pledges: string }[]
  ).map((row) => ({
    month: row.month,
    newPledgedMinor: BigInt(row.new_pledged_minor ?? "0"),
    newPledges: Number(row.new_pledges ?? 0),
  }));
}
