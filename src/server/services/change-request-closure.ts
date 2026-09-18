import { and, eq } from "drizzle-orm";

import type { Db, Tx } from "@/db";
import { auditLog, pledgeChangeRequests } from "@/db/schema";

/**
 * Closing a request whose pledge went away underneath it.
 *
 * A module of its own, and the reason is worth writing down: the pledge service
 * has to call this, and the change request service has to call the pledge
 * service to approve a reduction. Putting this function in change-requests.ts
 * would make those two modules import each other. A cycle through two large
 * server modules is the kind of thing that fails at build time with no useful
 * message, so the one function both of them need lives on its own and imports
 * neither.
 *
 * What it does is small. A pledge that is voided, cancelled or deleted while
 * somebody is waiting for an answer cannot have that answer: there is nothing
 * left to reduce or re-plan. Leaving the request pending would keep it in the
 * treasurer's queue for ever, holding the partial unique index against a pledge
 * nobody can act on, and telling the pledger their request is still being
 * considered when it cannot be. Closed says what happened without pretending
 * anybody decided it.
 */

/** Why a request was closed. Recorded on the row and in the journal. */
export type ClosureReason = "pledge_voided" | "pledge_cancelled" | "pledge_deleted";

const NOTES: Record<ClosureReason, string> = {
  pledge_voided: "Closed automatically: the pledge was voided.",
  pledge_cancelled: "Closed automatically: the pledge was cancelled.",
  pledge_deleted: "Closed automatically: the pledge was removed.",
};

export type CloseArgs = {
  pledgeId: string;
  because: ClosureReason;
  /**
   * The administrator whose action closed it, when there was one.
   *
   * Left on the audit row rather than in decided_by, because nobody decided
   * this request. They decided something about the pledge and this followed.
   * The check constraint allows a closed row with no decider for exactly that
   * reason.
   */
  adminId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * Closes the open request on a pledge, if there is one.
 *
 * Takes a transaction handle and is always called inside the transaction that
 * is voiding or deleting the pledge, so the two either both happen or neither
 * does. A pledge removed while its request stayed pending would leave the queue
 * describing a pledge that is not there.
 *
 * Returns how many were closed, which is zero or one: the partial unique index
 * allows no more.
 */
export async function closeForPledge(
  db: Db | Tx,
  args: CloseArgs,
): Promise<number> {
  const now = new Date();

  const closed = await db
    .update(pledgeChangeRequests)
    .set({
      status: "closed",
      decidedAt: now,
      decisionNote: NOTES[args.because],
    })
    .where(
      and(
        eq(pledgeChangeRequests.pledgeId, args.pledgeId),
        eq(pledgeChangeRequests.status, "pending"),
      ),
    )
    .returning({
      id: pledgeChangeRequests.id,
      kind: pledgeChangeRequests.kind,
    });

  for (const request of closed) {
    await db.insert(auditLog).values({
      actorType: args.adminId ? "admin" : "system",
      actorId: args.adminId ?? null,
      action: "pledge.change_closed",
      entity: "pledge",
      entityId: args.pledgeId,
      before: { requestId: request.id, kind: request.kind, status: "pending" },
      after: {
        requestId: request.id,
        kind: request.kind,
        status: "closed",
        because: args.because,
      },
      ip: args.ip ?? null,
      userAgent: args.userAgent ?? null,
    });
  }

  return closed.length;
}

/**
 * Whether a status a pledge is moving to means its open request is finished.
 *
 * Cancelled is here as well as void because the two are the same thing from a
 * waiting request's side: the pledge has stopped being a promise, so there is
 * nothing left to change about it. Fulfilled is not, because a payment that
 * never appeared against a pledge that is now paid off is still worth
 * somebody's attention.
 */
export function closureFor(status: string): ClosureReason | null {
  if (status === "void") return "pledge_voided";
  if (status === "cancelled") return "pledge_cancelled";
  return null;
}
