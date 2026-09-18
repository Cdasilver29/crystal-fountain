import { sql } from "drizzle-orm";

import type { Db, Tx } from "@/db";
import { auditLog, pledgeChangeRequests } from "@/db/schema";
import {
  type ChangeRequestInput,
  type ChangeRequestKind,
  type ChangeRequestStatus,
  reduceAmountRefusal,
} from "@/server/contracts/change-requests";
import type {
  PledgeFrequency,
  PledgeIntent,
  PledgeStatus,
  RedemptionChoice,
} from "@/server/contracts/pledges";
import { notFound, rejected, tooManyRequests } from "@/server/errors";
import {
  type Page,
  decodeCursor,
  pageSize,
  toPage,
} from "@/server/pagination";
import { maskPhone, type RequestContext } from "@/server/services/pledges";

/**
 * Pledge change requests.
 *
 * Plain functions taking (db, input). Nothing here imports from next, touches
 * Request or Response, or reads cookies.
 *
 * The shape of the feature is that a pledger can ask and only an administrator
 * can answer. Every function in this file either records what was asked or
 * reads the queue of what is waiting. None of them writes to a pledge. The two
 * that will, approve and decline, are stubs at the bottom: they belong with the
 * transaction and the increment ledger, and writing them here without those in
 * view is how a reduction ends up as a bare UPDATE on amount_minor.
 *
 * Authentication is the /redeem pairing and nothing else. A request is resolved
 * from a reference and the phone number that matches it, both of which the
 * pledger supplies, so this service never accepts a pledge id from a caller.
 * Walking references gets nothing without the matching number, and knowing
 * somebody's number gets nothing without their reference.
 */

/**
 * A database handle, inside a transaction or not.
 *
 * The helpers below are called both ways: from inside create()'s transaction,
 * and on their own from the retry path and the queue. Accepting either keeps
 * one implementation of each read rather than two that can drift.
 */
type Handle = Db | Tx;

/** How many requests one pledge may raise in the window. */
export const CHANGE_REQUEST_PLEDGE_LIMIT = 3;

/** The window that limit is counted over. A day. */
export const CHANGE_REQUEST_PLEDGE_WINDOW_SECONDS = 24 * 60 * 60;

/** How many requests one address may raise in the window. */
export const CHANGE_REQUEST_IP_LIMIT = 10;

/** The window that limit is counted over. An hour. */
export const CHANGE_REQUEST_IP_WINDOW_SECONDS = 60 * 60;

/**
 * The statuses a pledge can be in and still have something worth asking about.
 *
 * A cancelled or void pledge is not a promise any more, so there is nothing to
 * reduce, re-plan or cancel. A fulfilled one has been paid off, and a payment
 * that never showed up against it is still worth reporting, so it stays.
 */
const REQUESTABLE_STATUSES: readonly string[] = [
  "pending",
  "verified",
  "fulfilled",
];

/** One request, as the pledger's own screen and the admin queue both read it. */
export type ChangeRequestRow = {
  id: string;
  pledgeId: string;
  kind: ChangeRequestKind;
  status: ChangeRequestStatus;
  requestedAmountMinor: bigint | null;
  requestedFrequency: RedemptionChoice | null;
  requestedName: string | null;
  paymentReference: string | null;
  paymentAmountMinor: bigint | null;
  /** The date as it was given, yyyy-mm-dd. Never a Date, so no zone can move it. */
  paymentPaidOn: string | null;
  reason: string;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
};

type RawRequestRow = {
  id: string;
  pledge_id: string;
  kind: string;
  status: string;
  requested_amount_minor: string | null;
  requested_frequency: string | null;
  requested_name: string | null;
  payment_reference: string | null;
  payment_amount_minor: string | null;
  payment_paid_on: string | null;
  reason: string;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
};

function toRow(row: RawRequestRow): ChangeRequestRow {
  return {
    id: row.id,
    pledgeId: row.pledge_id,
    kind: row.kind as ChangeRequestKind,
    status: row.status as ChangeRequestStatus,
    requestedAmountMinor:
      row.requested_amount_minor === null
        ? null
        : BigInt(row.requested_amount_minor),
    requestedFrequency: row.requested_frequency as RedemptionChoice | null,
    requestedName: row.requested_name,
    paymentReference: row.payment_reference,
    paymentAmountMinor:
      row.payment_amount_minor === null
        ? null
        : BigInt(row.payment_amount_minor),
    paymentPaidOn: row.payment_paid_on,
    reason: row.reason,
    decidedAt: row.decided_at === null ? null : new Date(row.decided_at),
    decisionNote: row.decision_note,
    createdAt: new Date(row.created_at),
  };
}

/** The columns every read of this table selects. */
const REQUEST_COLUMNS = sql`
  r.id::text as id,
  r.pledge_id::text as pledge_id,
  r.kind,
  r.status,
  r.requested_amount_minor,
  r.requested_frequency,
  r.requested_name,
  r.payment_reference,
  r.payment_amount_minor,
  r.payment_paid_on::text as payment_paid_on,
  r.reason,
  r.decided_at,
  r.decision_note,
  r.created_at
`;

/* ---------------------------------------------------------------------------
 * Raising one.
 * ------------------------------------------------------------------------- */

export type CreateChangeRequestArgs = {
  input: ChangeRequestInput;
  campaignSlug: string;
  request?: RequestContext;
};

export type CreateChangeRequestResult = {
  /**
   * Whether this call recorded anything.
   *
   * "already_pending" is not an error and is not handed back as one. Somebody
   * who submits twice, or comes back a day later having forgotten, should see
   * the request they already have and what is happening to it, rather than a
   * refusal that tells them nothing about where it went.
   */
  outcome: "created" | "already_pending";
  request: ChangeRequestRow;
};

/** The pledge a request is about, as the service needs it. */
type TargetPledge = {
  id: string;
  reference: string;
  status: PledgeStatus;
  amountMinor: bigint;
};

/** The partial unique index that holds one open request per pledge. */
const ONE_PENDING_INDEX = "pledge_change_requests_one_pending_idx";

function isOnePendingViolation(error: unknown): boolean {
  const candidate = (error as { cause?: unknown }).cause ?? error;

  if (typeof candidate !== "object" || candidate === null) return false;

  const pg = candidate as { code?: unknown; constraint?: unknown };
  return pg.code === "23505" && pg.constraint === ONE_PENDING_INDEX;
}

/**
 * Records a request to change a pledge.
 *
 * One transaction: find the pledge from the pair, count the two limits, insert
 * the request, append the audit row. If any step fails, none of it happened.
 *
 * Nothing about the pledge moves. That is the whole design: this feature can
 * write one row in one table and an audit entry beside it, and a pledge is
 * changed only later, by an administrator, through the services that already
 * know how to do it properly.
 *
 * The one race worth naming is two submissions arriving together, both finding
 * no pending request and both inserting. The partial unique index rejects the
 * loser, and rather than surfacing a constraint violation to somebody who has
 * just typed out why they want their pledge reduced, the winner's request is
 * read back and returned as though they had found it there, which from their
 * side is exactly what happened.
 */
export async function create(
  db: Db,
  args: CreateChangeRequestArgs,
): Promise<CreateChangeRequestResult> {
  const { input, campaignSlug, request } = args;
  const ip = request?.ip ?? null;

  try {
    return await db.transaction(async (tx) => {
      const pledge = await findPledge(tx, campaignSlug, input);

      const pending = await readPending(tx, pledge.id);
      if (pending) return { outcome: "already_pending" as const, request: pending };

      if (input.kind === "reduce_amount") {
        const refusal = reduceAmountRefusal(
          input.requestedAmountMinor,
          pledge.amountMinor,
        );
        if (refusal) throw rejected("reduction_not_a_reduction", refusal);
      }

      await checkRateLimits(tx, pledge.id, ip);

      const [inserted] = await tx
        .insert(pledgeChangeRequests)
        .values({
          pledgeId: pledge.id,
          kind: input.kind,
          requestedAmountMinor:
            input.kind === "reduce_amount" ? input.requestedAmountMinor : null,
          requestedFrequency:
            input.kind === "change_plan" ? input.requestedFrequency : null,
          requestedName:
            input.kind === "correct_name" ? input.requestedName : null,
          paymentReference:
            input.kind === "payment_missing" ? input.paymentReference : null,
          paymentAmountMinor:
            input.kind === "payment_missing" ? input.paymentAmountMinor : null,
          paymentPaidOn:
            input.kind === "payment_missing" ? input.paymentPaidOn : null,
          reason: input.reason,
          contactPhoneE164: input.contactPhoneE164,
          sourceIp: ip,
        })
        .returning({ id: pledgeChangeRequests.id });

      /*
       * The journal entry.
       *
       * Actor type "public", because a pledger did this and not an
       * administrator, and grey on the audit screen for the same reason. The
       * payload carries what was asked for and nothing about who asked: the
       * contact number is on the row for the treasurer to ring, and it has no
       * business being copied into a journal that is read whole.
       */
      await tx.insert(auditLog).values({
        actorType: "public",
        action: "pledge.change_requested",
        entity: "pledge",
        entityId: pledge.id,
        after: {
          requestId: inserted.id,
          reference: pledge.reference,
          kind: input.kind,
          // jsonb cannot carry a bigint, so amounts go in as strings. Still
          // minor units, still exact.
          requestedAmountMinor:
            input.kind === "reduce_amount"
              ? input.requestedAmountMinor.toString()
              : null,
          requestedFrequency:
            input.kind === "change_plan" ? input.requestedFrequency : null,
          requestedName:
            input.kind === "correct_name" ? input.requestedName : null,
          paymentReference:
            input.kind === "payment_missing" ? input.paymentReference : null,
          paymentAmountMinor:
            input.kind === "payment_missing"
              ? input.paymentAmountMinor.toString()
              : null,
          paymentPaidOn:
            input.kind === "payment_missing" ? input.paymentPaidOn : null,
          currentAmountMinor: pledge.amountMinor.toString(),
          status: "pending",
        },
        ip,
        userAgent: request?.userAgent ?? null,
      });

      const row = await readById(tx, inserted.id);

      return { outcome: "created" as const, request: row };
    });
  } catch (error) {
    if (!isOnePendingViolation(error)) throw error;

    // The loser of the race. Somebody else's identical submission committed
    // between the read above and this insert, so hand back theirs.
    const pledge = await findPledge(db, campaignSlug, input);
    const pending = await readPending(db, pledge.id);

    if (!pending) throw error;

    return { outcome: "already_pending", request: pending };
  }
}

/**
 * The pledge a reference and a phone number both point at.
 *
 * Both, always, for the reason lookupPledgeInput gives: a reference is a
 * sequential counter anybody can walk, and in a congregation everybody has
 * everybody's number, so either alone would let one person file requests
 * against another person's pledge.
 *
 * A miss says the same thing however it missed, including for a soft deleted
 * pledge. Telling somebody that the reference is real but the number is wrong
 * hands back exactly the fact the pair exists to protect.
 */
async function findPledge(
  db: Handle,
  campaignSlug: string,
  input: ChangeRequestInput,
): Promise<TargetPledge> {
  const result = await db.execute(sql`
    select p.id::text as id,
           p.reference,
           p.status,
           p.amount_minor
    from pledges p
    join pledgers g on g.id = p.pledger_id
    join campaigns c on c.id = p.campaign_id
    where c.slug = ${campaignSlug}
      and p.deleted_at is null
      and p.reference = ${input.reference}
      and g.phone_e164 = ${input.contactPhoneE164}
    limit 1
  `);

  const row = result.rows[0] as
    | { id: string; reference: string; status: string; amount_minor: string }
    | undefined;

  if (!row) {
    throw notFound(
      "pledge_not_found",
      "We could not find a pledge with that reference and phone number. Check both and try again.",
    );
  }

  if (!REQUESTABLE_STATUSES.includes(row.status)) {
    throw rejected(
      "pledge_not_changeable",
      "That pledge has already been closed, so there is nothing to change. Please speak to the treasurer.",
    );
  }

  return {
    id: row.id,
    reference: row.reference,
    status: row.status as PledgeStatus,
    amountMinor: BigInt(row.amount_minor),
  };
}

/**
 * The two limits, counted off the requests themselves.
 *
 * No separate attempts table. A request is exactly the thing being limited and
 * it is already durable, so counting the rows is both simpler and impossible to
 * get out of step with reality. Counted from the database rather than memory so
 * the limit holds across every serverless instance and survives a redeploy.
 *
 * Every row counts, whatever became of it. A limiter that only counted pending
 * requests would let somebody file three, have them declined, and file three
 * more within the minute.
 */
async function checkRateLimits(
  db: Handle,
  pledgeId: string,
  ip: string | null,
): Promise<void> {
  const counts = await db.execute(sql`
    select
      count(*) filter (
        where pledge_id = ${pledgeId}::uuid
          and created_at > now() - make_interval(secs => ${CHANGE_REQUEST_PLEDGE_WINDOW_SECONDS})
      )::int as for_pledge,
      count(*) filter (
        where source_ip is not distinct from ${ip}::inet
          and created_at > now() - make_interval(secs => ${CHANGE_REQUEST_IP_WINDOW_SECONDS})
      )::int as for_ip
    from pledge_change_requests
    where created_at > now() - make_interval(secs => ${CHANGE_REQUEST_PLEDGE_WINDOW_SECONDS})
  `);

  const { for_pledge: forPledge, for_ip: forIp } = counts.rows[0] as {
    for_pledge: number;
    for_ip: number;
  };

  if (forPledge >= CHANGE_REQUEST_PLEDGE_LIMIT) {
    throw tooManyRequests(
      "change_request_pledge_limited",
      "This pledge has already had several requests today. Please wait until tomorrow, or call the treasurer.",
    );
  }

  if (forIp >= CHANGE_REQUEST_IP_LIMIT) {
    throw tooManyRequests(
      "change_request_ip_limited",
      "Too many requests from this connection. Please wait a while and try again.",
    );
  }
}

async function readById(db: Handle, id: string): Promise<ChangeRequestRow> {
  const result = await db.execute(sql`
    select ${REQUEST_COLUMNS}
    from pledge_change_requests r
    where r.id = ${id}::uuid
    limit 1
  `);

  return toRow(result.rows[0] as RawRequestRow);
}

async function readPending(
  db: Handle,
  pledgeId: string,
): Promise<ChangeRequestRow | null> {
  const result = await db.execute(sql`
    select ${REQUEST_COLUMNS}
    from pledge_change_requests r
    where r.pledge_id = ${pledgeId}::uuid
      and r.status = 'pending'
    limit 1
  `);

  const row = result.rows[0] as RawRequestRow | undefined;
  return row ? toRow(row) : null;
}

/**
 * The open request on a pledge, or null.
 *
 * What the member facing page reads to decide whether to show the form or the
 * state of what is already in the queue, and what C2 reads before deciding
 * anything. At most one exists, which the partial unique index guarantees
 * rather than this query hoping.
 */
export async function getPendingForPledge(
  db: Db,
  args: { pledgeId: string },
): Promise<ChangeRequestRow | null> {
  return readPending(db, args.pledgeId);
}

/* ---------------------------------------------------------------------------
 * The admin queue.
 * ------------------------------------------------------------------------- */

/** One row of the treasurer's queue, with everything the screen shows. */
export type AdminChangeRequestRow = ChangeRequestRow & {
  /** The pledge as it stands now, so a decision can be read against it. */
  reference: string;
  pledgerName: string;
  /** Masked unless the caller is allowed the whole number. Never null. */
  contactPhone: string;
  currentAmountMinor: bigint;
  currentStatus: PledgeStatus;
  currentIntent: PledgeIntent;
  currentFrequency: PledgeFrequency | null;
  currentInstallmentAmountMinor: bigint | null;
  /** Who answered it, once somebody has. */
  decidedByName: string | null;
};

type RawAdminRow = RawRequestRow & {
  contact_phone_e164: string;
  reference: string;
  pledger_name: string;
  current_amount_minor: string;
  current_status: string;
  current_intent: string;
  current_frequency: string | null;
  current_installment_amount_minor: string | null;
  decided_by_name: string | null;
};

export type ListChangeRequestsArgs = {
  campaignSlug: string;
  /** One status, or null for every status. */
  status?: ChangeRequestStatus | null;
  /** One kind, or null for every kind. */
  kind?: ChangeRequestKind | null;
  limit?: number;
  cursor?: string | null;
  /**
   * Whether the caller may see whole phone numbers. Decided by role in the
   * route handler and passed in, because a service knows nothing about roles.
   *
   * Masked here rather than in the caller, for the same reason pledges.search
   * masks there: a service that returned the whole number and trusted its
   * callers to hide it would leak one the day a second caller appears.
   */
  revealPhone: boolean;
};

/**
 * The queue, newest first, filtered and keyset paginated.
 *
 * Everything the screen shows comes back in this one query: the request, the
 * pledge it is about as it stands right now, and who answered it. The point is
 * that an administrator deciding a reduction is looking at the current amount
 * and the requested one side by side, and a screen that fetched the pledge
 * separately could show a figure that had moved between the two reads.
 *
 * Keyset paginated on (created_at, id) descending, like every other list here.
 * A cursor is only valid for the filters it was produced under, so changing a
 * filter clears it.
 */
export async function listForAdmin(
  db: Db,
  args: ListChangeRequestsArgs,
): Promise<Page<AdminChangeRequestRow>> {
  const limit = pageSize(args.limit);
  const cursor = decodeCursor(args.cursor);
  const status = args.status ?? null;
  const kind = args.kind ?? null;

  const cursorClause =
    cursor === null
      ? sql`true`
      : sql`(r.created_at, r.id) < (${cursor.key}::timestamptz, ${cursor.id}::uuid)`;

  const result = await db.execute(sql`
    select ${REQUEST_COLUMNS},
           r.contact_phone_e164,
           p.reference,
           g.full_name as pledger_name,
           p.amount_minor as current_amount_minor,
           p.status as current_status,
           p.intent as current_intent,
           p.installment_frequency as current_frequency,
           p.installment_amount_minor as current_installment_amount_minor,
           u.full_name as decided_by_name
    from pledge_change_requests r
    join pledges p on p.id = r.pledge_id
    join pledgers g on g.id = p.pledger_id
    join campaigns c on c.id = p.campaign_id
    left join admin_users u on u.id = r.decided_by
    where c.slug = ${args.campaignSlug}
      and (${status}::text is null or r.status = ${status})
      and (${kind}::text is null or r.kind = ${kind})
      and ${cursorClause}
    order by r.created_at desc, r.id desc
    limit ${limit + 1}
  `);

  const rows = (result.rows as RawAdminRow[]).map((row) => ({
    ...toRow(row),
    reference: row.reference,
    pledgerName: row.pledger_name,
    contactPhone: args.revealPhone
      ? row.contact_phone_e164
      : maskPhone(row.contact_phone_e164),
    currentAmountMinor: BigInt(row.current_amount_minor),
    currentStatus: row.current_status as PledgeStatus,
    currentIntent: row.current_intent as PledgeIntent,
    currentFrequency: row.current_frequency as PledgeFrequency | null,
    currentInstallmentAmountMinor:
      row.current_installment_amount_minor === null
        ? null
        : BigInt(row.current_installment_amount_minor),
    decidedByName: row.decided_by_name,
  }));

  return toPage(rows, limit, (row) => ({
    key: row.createdAt.toISOString(),
    id: row.id,
  }));
}

/* ---------------------------------------------------------------------------
 * Deciding. C2.
 * ------------------------------------------------------------------------- */

/**
 * Approving and declining are deliberately not written yet.
 *
 * Approving a reduction has to go through the increment ledger, in the same
 * transaction as the decision and the audit row, and then revalidate the
 * campaign totals; approving a missing payment has to route into the payment
 * recording flow that already exists rather than a second one written beside
 * it; approving a cancellation takes money off the figure the congregation is
 * watching and is the super administrator's alone. Each of those is a decision
 * about a transaction boundary, and the way to get them wrong is to sketch
 * them now and fill them in later.
 *
 * They throw rather than returning, so nothing can call them believing a
 * request was answered.
 */

export type DecideChangeRequestArgs = {
  requestId: string;
  adminId: string;
  /** Required on a decline, and at least ten characters. Checked in C2. */
  note?: string | null;
  request?: RequestContext;
};

/*
 * The arguments are named and unused on purpose: the signature is the part of
 * these two that C2 inherits, and a stub taking nothing would be a stub whose
 * callers all have to change the day it works.
 */
/* eslint-disable @typescript-eslint/no-unused-vars */

export async function approve(
  _db: Db,
  _args: DecideChangeRequestArgs,
): Promise<never> {
  throw new Error("not implemented in C1");
}

export async function decline(
  _db: Db,
  _args: DecideChangeRequestArgs,
): Promise<never> {
  throw new Error("not implemented in C1");
}
