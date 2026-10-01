import { sql } from "drizzle-orm";

import type { Db } from "@/db";
import { auditLog } from "@/db/schema";
import { conflict, forbidden, notFound } from "@/server/errors";
import {
  PAYMENT_DETAIL_FIELDS,
  type PaymentDetailField,
} from "@/server/contracts/campaign";

/**
 * Changes to where members' money is sent, held until a second person agrees.
 *
 * The paybill and bank details are shown to every member at once. Whoever can
 * change them alone can redirect every future payment, so saving them writes a
 * pending row here and the campaign keeps its current details. A different
 * active administrator approves, and only then do the new details go live.
 *
 * Every function returns what happened as notices, and the route handler emails
 * every active administrator from them. Nothing here sends anything: an email
 * cannot be rolled back, so it goes after the commit, from the caller.
 */

/** All eight payment fields, each a string or null. */
export type PaymentDetailValues = Record<PaymentDetailField, string | null>;

type Handle = Pick<Db, "execute" | "insert">;

export type PaymentChangeEvent = "requested" | "approved" | "rejected" | "expired";

/** Everything an email about one change needs, and nothing personal. */
export type PaymentChangeNotice = {
  event: PaymentChangeEvent;
  changeId: string;
  current: PaymentDetailValues;
  proposed: PaymentDetailValues;
  requestedByName: string;
  requestedAt: Date;
  expiresAt: Date;
  /** Null for a request, and for an expiry, which nobody decided. */
  decidedByName: string | null;
};

export type PendingPaymentChange = Omit<PaymentChangeNotice, "event" | "decidedByName"> & {
  requestedBy: string;
};

/** How long a change waits for its second signature. */
export const PAYMENT_CHANGE_TTL_DAYS = 7;

type ChangeRow = {
  id: string;
  campaign_id: string;
  current: PaymentDetailValues;
  proposed: PaymentDetailValues;
  status: string;
  requested_by: string;
  requested_by_name: string;
  requested_at: string | Date;
  expires_at: string | Date;
};

const SELECT_CHANGE = sql`
  select c.id, c.campaign_id, c.current, c.proposed, c.status,
         c.requested_by, a.full_name as requested_by_name,
         c.requested_at, c.expires_at
  from payment_detail_changes c
  join admin_users a on a.id = c.requested_by
`;

function toNotice(
  row: ChangeRow,
  event: PaymentChangeEvent,
  decidedByName: string | null,
): PaymentChangeNotice {
  return {
    event,
    changeId: row.id,
    current: row.current,
    proposed: row.proposed,
    requestedByName: row.requested_by_name,
    requestedAt: new Date(row.requested_at),
    expiresAt: new Date(row.expires_at),
    decidedByName,
  };
}

/** Whether two sets of payment details are the same, field by field. */
export function sameDetails(a: PaymentDetailValues, b: PaymentDetailValues): boolean {
  return PAYMENT_DETAIL_FIELDS.every((field) => (a[field] ?? null) === (b[field] ?? null));
}

/**
 * Records a request for new payment details, inside the caller's transaction.
 *
 * Called by the settings service with the campaign row already locked, so the
 * current details it is given are the ones live at this moment. Refuses while
 * another change is waiting: replacing a change a reviewer has already read
 * with a different one is exactly the substitution this exists to stop. The
 * database says the same through its one pending index.
 */
export async function requestChange(
  tx: Handle,
  args: {
    campaignId: string;
    current: PaymentDetailValues;
    proposed: PaymentDetailValues;
    adminId: string;
    request?: { ip?: string | null; userAgent?: string | null };
  },
): Promise<PaymentChangeNotice> {
  const waiting = await tx.execute(sql`
    select 1 from payment_detail_changes
    where campaign_id = ${args.campaignId}::uuid and status = 'pending'
      and expires_at > now()
    limit 1
  `);

  if (waiting.rows.length > 0) {
    throw conflict(
      "payment_change_pending",
      "A change to the payment details is already waiting for approval. Approve or reject it before asking for another.",
    );
  }

  const inserted = await tx.execute(sql`
    with created as (
      insert into payment_detail_changes
        (campaign_id, current, proposed, requested_by, expires_at)
      values (
        ${args.campaignId}::uuid,
        ${JSON.stringify(args.current)}::jsonb,
        ${JSON.stringify(args.proposed)}::jsonb,
        ${args.adminId}::uuid,
        now() + make_interval(days => ${PAYMENT_CHANGE_TTL_DAYS})
      )
      returning *
    )
    select c.id, c.campaign_id, c.current, c.proposed, c.status,
           c.requested_by, a.full_name as requested_by_name,
           c.requested_at, c.expires_at
    from created c
    join admin_users a on a.id = c.requested_by
  `);

  const row = inserted.rows[0] as ChangeRow;

  await tx.insert(auditLog).values({
    actorType: "admin",
    actorId: args.adminId,
    action: "campaign.payment_change_requested",
    entity: "campaign",
    entityId: args.campaignId,
    before: args.current,
    after: { ...args.proposed, changeId: row.id, changed: changedFields(row) },
    ip: args.request?.ip ?? null,
    userAgent: args.request?.userAgent ?? null,
  });

  return toNotice(row, "requested", null);
}

/** The fields a change actually moves, for the audit row and the email. */
export function changedFields(change: {
  current: PaymentDetailValues;
  proposed: PaymentDetailValues;
}): PaymentDetailField[] {
  return PAYMENT_DETAIL_FIELDS.filter(
    (field) => (change.current[field] ?? null) !== (change.proposed[field] ?? null),
  );
}

/**
 * Marks every waiting change past its seven days as expired.
 *
 * Run by the daily cron, and before anything that reads or decides a pending
 * change, so a stale request is never shown as live and never approved late.
 * One audit row per expiry, written by the system because nobody decided it.
 */
export async function expireStale(db: Db): Promise<PaymentChangeNotice[]> {
  return db.transaction(async (tx) => {
    const expired = await tx.execute(sql`
      with gone as (
        update payment_detail_changes
        set status = 'expired', decided_at = now()
        where status = 'pending' and expires_at <= now()
        returning *
      )
      select c.id, c.campaign_id, c.current, c.proposed, c.status,
             c.requested_by, a.full_name as requested_by_name,
             c.requested_at, c.expires_at
      from gone c
      join admin_users a on a.id = c.requested_by
    `);

    const rows = expired.rows as ChangeRow[];

    for (const row of rows) {
      await tx.insert(auditLog).values({
        actorType: "system",
        actorId: null,
        action: "campaign.payment_change_expired",
        entity: "campaign",
        entityId: row.campaign_id,
        before: row.current,
        after: { ...row.proposed, changeId: row.id, changed: changedFields(row) },
      });
    }

    return rows.map((row) => toNotice(row, "expired", null));
  });
}

/** The change waiting for a second signature, if there is one. */
export async function getPending(
  db: Pick<Db, "execute">,
  args: { campaignId: string },
): Promise<PendingPaymentChange | null> {
  const result = await db.execute(sql`
    ${SELECT_CHANGE}
    where c.campaign_id = ${args.campaignId}::uuid
      and c.status = 'pending' and c.expires_at > now()
    limit 1
  `);

  const row = result.rows[0] as ChangeRow | undefined;
  if (!row) return null;

  return {
    changeId: row.id,
    current: row.current,
    proposed: row.proposed,
    requestedByName: row.requested_by_name,
    requestedAt: new Date(row.requested_at),
    expiresAt: new Date(row.expires_at),
    requestedBy: row.requested_by,
  };
}

export type DecideArgs = {
  changeId: string;
  decision: "approve" | "reject";
  adminId: string;
  request?: { ip?: string | null; userAgent?: string | null };
};

/**
 * Approves or rejects a waiting change, in one transaction.
 *
 * Approval is refused to the person who asked, whatever their role, and to
 * anybody the database does not hold as an active administrator at this
 * moment. The route has already checked the permission; this is the second
 * lock on the same door, and the check constraint on the table is the third.
 *
 * Approval also refuses when the live details are no longer the ones the
 * change was asked against. A reviewer approves a before and an after, and
 * applying their after over some other before would put details live that
 * nobody has compared.
 *
 * Rejecting is open to the requester as well, so a mistaken request can be
 * withdrawn without waiting seven days.
 */
export async function decide(db: Db, args: DecideArgs): Promise<PaymentChangeNotice> {
  return db.transaction(async (tx) => {
    const found = await tx.execute(sql`
      ${SELECT_CHANGE}
      where c.id = ${args.changeId}::uuid
      for update of c
    `);

    const row = found.rows[0] as ChangeRow | undefined;

    if (!row) {
      throw notFound("payment_change_not_found", "That payment detail change does not exist.");
    }

    if (row.status !== "pending" || new Date(row.expires_at) <= new Date()) {
      throw conflict(
        "payment_change_not_pending",
        "That change is no longer waiting for a decision. It may have been decided by somebody else, or expired.",
      );
    }

    const decider = await tx.execute(sql`
      select full_name, role, is_active from admin_users where id = ${args.adminId}::uuid
    `);
    const who = decider.rows[0] as
      | { full_name: string; role: string; is_active: boolean }
      | undefined;

    if (!who || !who.is_active) {
      throw forbidden("admin_inactive", "Only an active administrator can decide this.");
    }

    if (args.decision === "approve") {
      if (args.adminId === row.requested_by) {
        throw forbidden(
          "payment_change_self_approval",
          "You asked for this change, so somebody else has to approve it.",
        );
      }

      if (who.role !== "admin") {
        throw forbidden(
          "payment_change_needs_admin",
          "Only an administrator can approve a change to the payment details.",
        );
      }

      const live = await tx.execute(sql`
        select mpesa_paybill as "mpesaPaybill",
               mpesa_account_name as "mpesaAccountName",
               bank_name as "bankName",
               bank_branch as "bankBranch",
               bank_account_name as "bankAccountName",
               bank_account as "bankAccount",
               bank_swift as "bankSwift",
               bank_branch_code as "bankBranchCode"
        from campaigns where id = ${row.campaign_id}::uuid
        for update
      `);

      if (!sameDetails(live.rows[0] as PaymentDetailValues, row.current)) {
        throw conflict(
          "payment_change_stale",
          "The payment details have changed since this was asked for. Reject it and ask again.",
        );
      }

      const p = row.proposed;
      await tx.execute(sql`
        update campaigns set
          mpesa_paybill = ${p.mpesaPaybill ?? null},
          mpesa_account_name = ${p.mpesaAccountName ?? null},
          bank_name = ${p.bankName ?? null},
          bank_branch = ${p.bankBranch ?? null},
          bank_account_name = ${p.bankAccountName ?? null},
          bank_account = ${p.bankAccount ?? null},
          bank_swift = ${p.bankSwift ?? null},
          bank_branch_code = ${p.bankBranchCode ?? null}
        where id = ${row.campaign_id}::uuid
      `);
    }

    const status = args.decision === "approve" ? "approved" : "rejected";

    await tx.execute(sql`
      update payment_detail_changes
      set status = ${status}, decided_by = ${args.adminId}::uuid, decided_at = now()
      where id = ${row.id}::uuid
    `);

    await tx.insert(auditLog).values({
      actorType: "admin",
      actorId: args.adminId,
      action: `campaign.payment_change_${status}`,
      entity: "campaign",
      entityId: row.campaign_id,
      before: row.current,
      after: {
        ...row.proposed,
        changeId: row.id,
        changed: changedFields(row),
        requestedBy: row.requested_by,
      },
      ip: args.request?.ip ?? null,
      userAgent: args.request?.userAgent ?? null,
    });

    return toNotice(row, status, who.full_name);
  });
}

/**
 * Where every notice goes: each active portal account.
 *
 * Every role, not only administrators. The details being changed are the ones
 * printed on every public page, so nothing here is more private than the site
 * already is, and a substitution is caught by whoever happens to read first.
 */
export async function noticeRecipients(db: Pick<Db, "execute">): Promise<string[]> {
  const result = await db.execute(sql`
    select email from admin_users where is_active order by created_at
  `);
  return (result.rows as { email: string }[]).map((row) => row.email);
}
