import { sql } from "drizzle-orm";

import type { Db } from "@/db";

/**
 * The daily digest: what happened, and what is waiting for somebody.
 *
 * Auto approval puts a pledge under the limit straight onto the public total
 * with nobody looking, and the admin queues only work if somebody opens them.
 * So once a day the people who act on those queues are told, in one short
 * email, what arrived and what is waiting.
 *
 * Plain functions over a db handle. The cron route decides when, sends, and
 * knows where the email configuration comes from.
 */

const NAIROBI = "Africa/Nairobi";

/**
 * Whether today's run sends, and how far back it looks.
 *
 * Nothing is sent on the Sabbath, Friday sunset to Saturday sunset in
 * Nairobi. The job runs just after midnight Nairobi time, so the run that
 * falls inside the Sabbath is the one dated Saturday, and that is the one
 * skipped. Sunday's run, just after Saturday midnight and well after sunset,
 * looks back 48 hours, so Friday's activity is not lost but rolled into it.
 *
 * Decided from the Nairobi calendar date of the run rather than the server's,
 * which is UTC on Vercel and still on Friday when Nairobi is on Saturday.
 */
export function digestSchedule(
  now: Date,
): { send: false; reason: "sabbath" } | { send: true; windowHours: 24 | 48 } {
  const weekday = new Intl.DateTimeFormat("en-GB", {
    timeZone: NAIROBI,
    weekday: "long",
  }).format(now);

  if (weekday === "Saturday") return { send: false, reason: "sabbath" };
  return { send: true, windowHours: weekday === "Sunday" ? 48 : 24 };
}

/** One setting or payment detail event in the window, as recorded. */
export type DigestSettingEvent = {
  at: Date;
  action: string;
  byName: string | null;
  /** The fields that moved on a campaign.updated row, old and new. */
  moves: { field: string; was: unknown; now: unknown }[];
};

export type DigestData = {
  since: Date;
  pledges: {
    /** Applied submissions in the window: new pledges and additions. */
    count: number;
    newPledges: number;
    additions: number;
    totalMinor: bigint;
    /** The largest single submission, by the pledger's name. */
    largest: {
      pledgeId: string;
      reference: string;
      name: string;
      amountMinor: bigint;
    } | null;
  };
  waiting: {
    heldAdditions: number;
    changeRequests: number;
    pendingPledges: number;
    pendingPaymentChanges: number;
  };
  settings: DigestSettingEvent[];
};

/** Nothing happened and nothing is waiting: no email. */
export function isEmpty(data: DigestData): boolean {
  const w = data.waiting;
  return (
    data.pledges.count === 0 &&
    data.settings.length === 0 &&
    w.heldAdditions + w.changeRequests + w.pendingPledges + w.pendingPaymentChanges === 0
  );
}

/**
 * Everything the digest says, read in one go.
 *
 * Pledges are counted off the increments that count, the applied ones, so an
 * addition is a pledge received just as a first pledge is, and a held
 * addition is not until it is confirmed: it appears under waiting instead.
 * Removed pledges are left out everywhere.
 *
 * Names and amounts only. No phone number and no address is selected, so
 * none can find its way into the email.
 */
export async function gather(
  db: Db,
  args: { campaignSlug: string; since: Date },
): Promise<DigestData> {
  const since = args.since.toISOString();

  const totals = await db.execute(sql`
    select count(*)::int as count,
           count(distinct p.id) filter (where p.created_at >= ${since}::timestamptz)::int as new_pledges,
           coalesce(sum(i.amount_minor), 0)::text as total_minor
    from pledge_increments i
    join pledges p on p.id = i.pledge_id
    join campaigns c on c.id = p.campaign_id
    where c.slug = ${args.campaignSlug}
      and p.deleted_at is null
      and i.status = 'applied'
      and i.amount_minor > 0
      and i.created_at >= ${since}::timestamptz
  `);

  const largest = await db.execute(sql`
    select p.id::text as pledge_id, p.reference, g.full_name as name,
           i.amount_minor::text as amount_minor
    from pledge_increments i
    join pledges p on p.id = i.pledge_id
    join pledgers g on g.id = p.pledger_id
    join campaigns c on c.id = p.campaign_id
    where c.slug = ${args.campaignSlug}
      and p.deleted_at is null
      and i.status = 'applied'
      and i.amount_minor > 0
      and i.created_at >= ${since}::timestamptz
    order by i.amount_minor desc, i.created_at
    limit 1
  `);

  const waiting = await db.execute(sql`
    select
      (select count(*)::int from pledge_increments i
         join pledges p on p.id = i.pledge_id
         join campaigns c on c.id = p.campaign_id
        where c.slug = ${args.campaignSlug} and p.deleted_at is null
          and i.status = 'held') as held_additions,
      (select count(*)::int from pledge_change_requests r
         join pledges p on p.id = r.pledge_id
         join campaigns c on c.id = p.campaign_id
        where c.slug = ${args.campaignSlug} and r.status = 'pending') as change_requests,
      (select count(*)::int from pledges p
         join campaigns c on c.id = p.campaign_id
        where c.slug = ${args.campaignSlug} and p.deleted_at is null
          and p.status = 'pending') as pending_pledges,
      (select count(*)::int from payment_detail_changes x
         join campaigns c on c.id = x.campaign_id
        where c.slug = ${args.campaignSlug} and x.status = 'pending') as pending_payment_changes
  `);

  const settings = await db.execute(sql`
    select a.at, a.action, u.full_name as by_name, a.before, a.after
    from audit_log a
    left join admin_users u on u.id = a.actor_id
    where a.at >= ${since}::timestamptz
      and a.action in (
        'campaign.updated',
        'campaign.payment_change_requested',
        'campaign.payment_change_approved',
        'campaign.payment_change_rejected',
        'campaign.payment_change_expired'
      )
    order by a.at
  `);

  const t = totals.rows[0] as { count: number; new_pledges: number; total_minor: string };
  const big = largest.rows[0] as
    | { pledge_id: string; reference: string; name: string; amount_minor: string }
    | undefined;
  const w = waiting.rows[0] as {
    held_additions: number;
    change_requests: number;
    pending_pledges: number;
    pending_payment_changes: number;
  };

  return {
    since: args.since,
    pledges: {
      count: t.count,
      newPledges: t.new_pledges,
      additions: t.count - t.new_pledges,
      totalMinor: BigInt(t.total_minor),
      largest: big
        ? {
            pledgeId: big.pledge_id,
            reference: big.reference,
            name: big.name,
            amountMinor: BigInt(big.amount_minor),
          }
        : null,
    },
    waiting: {
      heldAdditions: w.held_additions,
      changeRequests: w.change_requests,
      pendingPledges: w.pending_pledges,
      pendingPaymentChanges: w.pending_payment_changes,
    },
    settings: (
      settings.rows as {
        at: string | Date;
        action: string;
        by_name: string | null;
        before: Record<string, unknown> | null;
        after: Record<string, unknown> | null;
      }[]
    ).map((row) => {
      const changed = Array.isArray(row.after?.changed)
        ? (row.after.changed as unknown[]).filter(
            (f): f is string => typeof f === "string",
          )
        : [];
      return {
        at: new Date(row.at),
        action: row.action,
        byName: row.by_name,
        moves:
          row.action === "campaign.updated"
            ? changed.map((field) => ({
                field,
                was: row.before?.[field],
                now: row.after?.[field],
              }))
            : [],
      };
    }),
  };
}

/**
 * Who receives it: active administrators and treasurers.
 *
 * Not viewers. They act on no queue, and the digest names pledgers and
 * amounts, so it goes only to the people whose job it is to act on it.
 */
export async function recipients(db: Pick<Db, "execute">): Promise<string[]> {
  const result = await db.execute(sql`
    select email::text as email from admin_users
    where is_active and role in ('admin', 'treasurer')
    order by created_at
  `);
  return (result.rows as { email: string }[]).map((row) => row.email);
}
