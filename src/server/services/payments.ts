import { and, eq, isNull, sql } from "drizzle-orm";

import type { Db, Tx } from "@/db";
import {
  auditLog,
  campaigns,
  paymentAllocations,
  payments,
  pledges,
} from "@/db/schema";
import type {
  AllocatePaymentInput,
  RecordPaymentInput,
} from "@/server/contracts/payments";
import type { PledgeStatus } from "@/server/contracts/pledges";
import { conflict, notFound } from "@/server/errors";
import { formatKes, kesToMinor } from "@/server/money";
import {
  decodeCursor,
  pageSize,
  toPage,
  type Page,
} from "@/server/pagination";

/**
 * Money in.
 *
 * Recording a payment is the treasurer saying "this arrived". It is not an
 * allocation: recording touches no pledge. Matching a payment to the promise it
 * settles is a separate act with its own audit row, further down this file.
 *
 * Worth knowing before reading further: v_campaign_totals sums every payment
 * with status 'received' for the campaign, with no reference to whether it has
 * been allocated. So a row written here moves the figure on the home page
 * immediately. That is the intended reading of "received", but it means this
 * is a totals affecting operation and the verification query belongs with it.
 *
 * A plain function taking a db handle and a typed input, per CLAUDE.md. It
 * never touches Request, Response, cookies or next/headers.
 */

export type RecordPaymentArgs = {
  input: RecordPaymentInput;
  campaignSlug: string;
  /** The admin_users row of whoever is recording it. Never null now. */
  adminId: string;
  request?: { ip: string | null; userAgent: string | null };
};

export type RecordPaymentResult = {
  paymentId: string;
  amountMinor: bigint;
  currency: string;
  status: string;
  paidAt: Date;
};

/** Postgres unique violation. */
const UNIQUE_VIOLATION = "23505";

/**
 * Whether this is a unique violation on the named constraint.
 *
 * The cause chain has to be walked. Drizzle wraps the driver error in a
 * DrizzleQueryError carrying the sql and params, and the pg fields that
 * actually identify the violation, code and constraint, sit on the cause
 * underneath. Reading them off the top level error finds nothing and quietly
 * turns a duplicate receipt into a 500, which is exactly what it did before
 * this function learned to look deeper.
 */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error;

  for (let depth = 0; current && depth < 5; depth++) {
    if (typeof current !== "object") return false;
    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (
      candidate.code === UNIQUE_VIOLATION &&
      candidate.constraint === constraint
    ) {
      return true;
    }
    current = candidate.cause;
  }

  return false;
}

export async function record(
  db: Db,
  args: RecordPaymentArgs,
): Promise<RecordPaymentResult> {
  const { input, campaignSlug, adminId, request } = args;

  try {
    // One transaction or nothing. The payment and its audit row are a single
    // fact and there is no state in which one exists without the other.
    return await db.transaction(async (tx) => {
      const [campaign] = await tx
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(eq(campaigns.slug, campaignSlug))
        .limit(1);

      if (!campaign) {
        throw notFound(
          "campaign_not_found",
          `No campaign with slug ${campaignSlug}.`,
        );
      }

      const amountMinor = kesToMinor(input.amountKes);

      const [payment] = await tx
        .insert(payments)
        .values({
          campaignId: campaign.id,
          method: input.method,
          externalRef: input.externalRef,
          amountMinor,
          // The form collects a day, not an instant. Noon UTC keeps the date
          // reading the same in Nairobi (UTC+3) as it does in the database,
          // which midnight would not.
          paidAt: new Date(`${input.paidAt}T12:00:00Z`),
          payerNameRaw: input.payerName,
          payerMsisdn: input.payerPhone,
          accountRefRaw: input.accountRef,
          status: "received",
          recordedBy: adminId,
        })
        .returning({
          id: payments.id,
          amountMinor: payments.amountMinor,
          currency: payments.currency,
          status: payments.status,
          paidAt: payments.paidAt,
        });

      if (!payment) throw new Error("payments insert returned no row");

      // CLAUDE.md: every admin write appends an audit row. No exceptions.
      await tx.insert(auditLog).values({
        actorType: "admin",
        actorId: adminId,
        action: "payment.recorded",
        entity: "payment",
        entityId: payment.id,
        after: {
          method: input.method,
          externalRef: input.externalRef,
          // jsonb cannot carry a bigint, so the amount goes in as a string. It
          // is still exact minor units.
          amountMinor: payment.amountMinor.toString(),
          currency: payment.currency,
          paidAt: payment.paidAt.toISOString(),
          payerName: input.payerName,
          payerPhone: input.payerPhone,
          accountRef: input.accountRef,
          note: input.note,
        },
        ip: request?.ip ?? null,
        userAgent: request?.userAgent ?? null,
      });

      return {
        paymentId: payment.id,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        status: payment.status,
        paidAt: payment.paidAt,
      };
    });
  } catch (error) {
    /*
     * The same receipt entered twice.
     *
     * payments_channel_ref_uq is a partial unique index on (method,
     * external_ref) where external_ref is not null, so the database is what
     * actually prevents this. Checking first and inserting after would leave a
     * race between the two statements. The violation is caught and translated
     * instead, which is correct under concurrency and needs no extra query on
     * the path that succeeds.
     */
    if (isUniqueViolation(error, "payments_channel_ref_uq")) {
      throw conflict(
        "duplicate_payment",
        `A ${input.method} payment with reference ${input.externalRef} has already been recorded.`,
      );
    }
    throw error;
  }
}

/* ---------------------------------------------------------------------------
 * Allocation: matching money to a promise.
 * ------------------------------------------------------------------------- */

/** Caller details recorded on the audit row. Supplied by the route handler. */
export type RequestContext = {
  /** Must be a valid IP or null. The audit_log column is inet. */
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * An amount stated so that neither reading of it can be wrong.
 *
 * formatKes truncates to whole shillings, which is right for every amount that
 * came through kesToMinor but would quietly misreport a part shilling
 * allocation. The minor units sit beside it, and they are the authority.
 */
function exact(minorAmount: bigint): string {
  return `${formatKes(minorAmount)} (${minorAmount} minor units)`;
}

/**
 * What a payment has committed so far, ignoring reversed allocations.
 *
 * This is the same sum assert_allocation_within_payment() computes. Reading it
 * here as well is not redundant: the trigger can only raise a database
 * exception with a payment uuid in it, and the treasurer needs to be told in
 * shillings what is actually left. The trigger stays as the backstop that
 * holds under concurrency.
 */
async function allocatedForPayment(tx: Tx, paymentId: string): Promise<bigint> {
  const [row] = await tx
    .select({
      total: sql<string>`coalesce(sum(${paymentAllocations.amountMinor}), 0)`,
    })
    .from(paymentAllocations)
    .where(
      and(
        eq(paymentAllocations.paymentId, paymentId),
        isNull(paymentAllocations.reversedAt),
      ),
    );

  // The driver hands a sum over bigint back as a string. It becomes a BigInt
  // here without ever passing through a JavaScript number.
  return BigInt(row?.total ?? "0");
}

/** What a pledge has been paid, ignoring reversed allocations. */
async function paidForPledge(tx: Tx, pledgeId: string): Promise<bigint> {
  const [row] = await tx
    .select({
      total: sql<string>`coalesce(sum(${paymentAllocations.amountMinor}), 0)`,
    })
    .from(paymentAllocations)
    .where(
      and(
        eq(paymentAllocations.pledgeId, pledgeId),
        isNull(paymentAllocations.reversedAt),
      ),
    );

  return BigInt(row?.total ?? "0");
}

export type AllocatePaymentArgs = {
  paymentId: string;
  input: AllocatePaymentInput;
  /** The admin_users row of whoever is allocating. */
  adminId: string;
  request?: RequestContext;
};

export type AllocatePaymentResult = {
  allocationId: string;
  paymentId: string;
  pledgeId: string;
  pledgeReference: string;
  amountMinor: bigint;
  currency: string;
  allocatedAt: Date;
  /** The payment after this allocation. */
  paymentAmountMinor: bigint;
  paymentAllocatedMinor: bigint;
  paymentUnallocatedMinor: bigint;
  /** The pledge after this allocation, as v_pledge_balances will report it. */
  pledgeAmountMinor: bigint;
  pledgePaidMinor: bigint;
  pledgeOutstandingMinor: bigint;
  pledgeStatus: PledgeStatus;
  /** Whether this call is what moved the pledge to fulfilled. */
  pledgeFulfilled: boolean;
};

/**
 * Allocates a payment, or part of one, to a pledge.
 *
 * One transaction covering: the two locks, the over allocation check, the
 * allocation row, its audit row, and the fulfilled transition with an audit row
 * of its own. If any step fails, none of it happened.
 *
 * Locking order is payment first, then pledge, and deallocate() uses the same
 * order. Two treasurers working on the same pair from opposite directions
 * therefore queue rather than deadlock. The payment lock is also what makes the
 * read of the unallocated remainder trustworthy: without it, two allocations
 * could each read the same stale sum and both decide they fit.
 *
 * Note what this does not do. It never calls revalidateTag, because a service
 * in src/server may not import from next. The route handler invalidates the
 * campaign totals tag, exactly as the record endpoint does.
 */
export async function allocate(
  db: Db,
  args: AllocatePaymentArgs,
): Promise<AllocatePaymentResult> {
  const { paymentId, input, adminId, request } = args;

  return db.transaction(async (tx) => {
    const [payment] = await tx
      .select({
        id: payments.id,
        campaignId: payments.campaignId,
        method: payments.method,
        externalRef: payments.externalRef,
        amountMinor: payments.amountMinor,
        currency: payments.currency,
        status: payments.status,
      })
      .from(payments)
      .where(eq(payments.id, paymentId))
      .for("update")
      .limit(1);

    if (!payment) {
      throw notFound("payment_not_found", "That payment does not exist.");
    }

    // A reversed or disputed payment is not money we can promise to anyone.
    if (payment.status !== "received") {
      throw conflict(
        "payment_not_received",
        `That payment is ${payment.status}, so it cannot be allocated.`,
      );
    }

    const allocatedBefore = await allocatedForPayment(tx, payment.id);
    const unallocated = payment.amountMinor - allocatedBefore;

    if (unallocated <= 0n) {
      throw conflict(
        "payment_fully_allocated",
        `That payment of ${exact(payment.amountMinor)} is already fully allocated.`,
      );
    }

    const [pledge] = await tx
      .select({
        id: pledges.id,
        campaignId: pledges.campaignId,
        reference: pledges.reference,
        amountMinor: pledges.amountMinor,
        status: pledges.status,
      })
      .from(pledges)
      .where(eq(pledges.id, input.pledgeId))
      .for("update")
      .limit(1);

    if (!pledge) {
      throw notFound("pledge_not_found", "That pledge does not exist.");
    }

    // Both rows carry a campaign_id and nothing in the schema stops them
    // disagreeing. Money raised for one campaign must never settle a promise
    // made to another.
    if (pledge.campaignId !== payment.campaignId) {
      throw conflict(
        "campaign_mismatch",
        `${pledge.reference} belongs to a different campaign from that payment.`,
      );
    }

    if (pledge.status === "cancelled" || pledge.status === "void") {
      throw conflict(
        "pledge_not_allocatable",
        `${pledge.reference} is ${pledge.status}, so money cannot be allocated to it.`,
      );
    }

    const paidBefore = await paidForPledge(tx, pledge.id);
    const outstanding = pledge.amountMinor - paidBefore;

    if (outstanding <= 0n) {
      throw conflict(
        "pledge_fully_paid",
        `${pledge.reference} is already paid in full.`,
      );
    }

    /*
     * The default is the whole of whichever side runs out first. A KES 5,000
     * payment against a KES 2,000 outstanding balance allocates 2,000 and
     * leaves 3,000 for another pledge, and the same payment against a 9,000
     * balance allocates all 5,000.
     */
    const amountMinor =
      input.amountMinor ??
      (unallocated < outstanding ? unallocated : outstanding);

    if (amountMinor > unallocated) {
      throw conflict(
        "exceeds_payment",
        `That payment has ${exact(unallocated)} left to allocate, and this would allocate ${exact(amountMinor)}.`,
      );
    }

    /*
     * Over paying a pledge is refused rather than absorbed. Allowing it would
     * put a negative outstanding_minor in v_pledge_balances, which nothing
     * downstream is written to read. A payer who sent more than they promised
     * has a genuine surplus, and the right home for it is another pledge or
     * the unallocated remainder, not a balance that reads as less than zero.
     */
    if (amountMinor > outstanding) {
      throw conflict(
        "exceeds_pledge",
        `${pledge.reference} has ${exact(outstanding)} outstanding, and this would allocate ${exact(amountMinor)}.`,
      );
    }

    const [allocation] = await tx
      .insert(paymentAllocations)
      .values({
        paymentId: payment.id,
        pledgeId: pledge.id,
        amountMinor,
        allocatedBy: adminId,
      })
      .returning({
        id: paymentAllocations.id,
        amountMinor: paymentAllocations.amountMinor,
        allocatedAt: paymentAllocations.allocatedAt,
      });

    if (!allocation) {
      throw new Error("payment_allocations insert returned no row");
    }

    // CLAUDE.md: every admin write appends an audit row. No exceptions.
    await tx.insert(auditLog).values({
      actorType: "admin",
      actorId: adminId,
      action: "payment.allocated",
      entity: "payment_allocation",
      entityId: allocation.id,
      after: {
        paymentId: payment.id,
        // A payment has no human reference of its own. The receipt or slip
        // number is what the treasurer would recognise it by, and it is null
        // for cash.
        paymentRef: payment.externalRef,
        paymentMethod: payment.method,
        pledgeId: pledge.id,
        pledgeReference: pledge.reference,
        // jsonb cannot carry a bigint, so amounts go in as strings. They are
        // still exact minor units.
        amountMinor: allocation.amountMinor.toString(),
        currency: payment.currency,
      },
      ip: request?.ip ?? null,
      userAgent: request?.userAgent ?? null,
    });

    const paidAfter = paidBefore + allocation.amountMinor;
    const outstandingAfter = pledge.amountMinor - paidAfter;

    /*
     * Fulfilled is reached from verified and from nowhere else.
     *
     * A pending pledge is one nobody has approved yet, and v_campaign_totals
     * counts verified and fulfilled alike toward the public pledged figure.
     * Letting money alone carry a pledge from pending to fulfilled would
     * approve it as a side effect and move the number on the home page without
     * anyone deciding to. Paying a pending pledge in full is allowed and
     * recorded; it simply stays pending until an admin approves it.
     */
    const shouldFulfil = outstandingAfter === 0n && pledge.status === "verified";
    let pledgeStatus = pledge.status as PledgeStatus;

    if (shouldFulfil) {
      const now = new Date();

      const [updated] = await tx
        .update(pledges)
        .set({ status: "fulfilled", updatedAt: now })
        .where(and(eq(pledges.id, pledge.id), eq(pledges.status, "verified")))
        .returning({ status: pledges.status });

      if (!updated) {
        throw conflict(
          "invalid_transition",
          `${pledge.reference} is no longer verified.`,
        );
      }

      pledgeStatus = updated.status as PledgeStatus;

      // A second row, because this is a second fact. The allocation and the
      // status change are separate things that happened to the ledger, and a
      // reader should not have to infer one from the other.
      await tx.insert(auditLog).values({
        actorType: "admin",
        actorId: adminId,
        action: "pledge.fulfilled",
        entity: "pledge",
        entityId: pledge.id,
        before: { status: "verified" },
        after: {
          status: updated.status,
          reference: pledge.reference,
          paidMinor: paidAfter.toString(),
          outstandingMinor: "0",
          allocationId: allocation.id,
        },
        ip: request?.ip ?? null,
        userAgent: request?.userAgent ?? null,
      });
    }

    return {
      allocationId: allocation.id,
      paymentId: payment.id,
      pledgeId: pledge.id,
      pledgeReference: pledge.reference,
      amountMinor: allocation.amountMinor,
      currency: payment.currency,
      allocatedAt: allocation.allocatedAt,
      paymentAmountMinor: payment.amountMinor,
      paymentAllocatedMinor: allocatedBefore + allocation.amountMinor,
      paymentUnallocatedMinor: unallocated - allocation.amountMinor,
      pledgeAmountMinor: pledge.amountMinor,
      pledgePaidMinor: paidAfter,
      pledgeOutstandingMinor: outstandingAfter,
      pledgeStatus,
      pledgeFulfilled: shouldFulfil,
    };
  });
}

export type DeallocatePaymentArgs = {
  paymentId: string;
  allocationId: string;
  adminId: string;
  request?: RequestContext;
};

export type DeallocatePaymentResult = {
  allocationId: string;
  paymentId: string;
  pledgeId: string;
  pledgeReference: string;
  amountMinor: bigint;
  currency: string;
  reversedAt: Date;
  paymentAmountMinor: bigint;
  paymentAllocatedMinor: bigint;
  paymentUnallocatedMinor: bigint;
  pledgeAmountMinor: bigint;
  pledgePaidMinor: bigint;
  pledgeOutstandingMinor: bigint;
  pledgeStatus: PledgeStatus;
  /** Whether this call is what moved the pledge back off fulfilled. */
  pledgeReverted: boolean;
};

/**
 * Reverses an allocation, for a correction.
 *
 * The row is not deleted. CLAUDE.md: corrections are new rows, not edits, and
 * an allocation is a ledger fact that decided a pledge's paid balance. Setting
 * reversed_at keeps both the original match and the correction, and migration
 * 0004 taught v_pledge_balances and the over allocation trigger to ignore a
 * reversed row, so the amount is freed for reallocation and no balance can
 * still see it.
 *
 * Admin only. That is enforced in the route handler, not here, because a
 * service knows nothing about who is calling beyond the id it is handed.
 */
export async function deallocate(
  db: Db,
  args: DeallocatePaymentArgs,
): Promise<DeallocatePaymentResult> {
  const { paymentId, allocationId, adminId, request } = args;

  return db.transaction(async (tx) => {
    // Payment first, then pledge, matching allocate(). Locking the payment is
    // what serialises a reversal against a concurrent allocation of the same
    // payment, so the remainder each of them reports is the truth.
    const [payment] = await tx
      .select({
        id: payments.id,
        method: payments.method,
        externalRef: payments.externalRef,
        amountMinor: payments.amountMinor,
        currency: payments.currency,
      })
      .from(payments)
      .where(eq(payments.id, paymentId))
      .for("update")
      .limit(1);

    if (!payment) {
      throw notFound("payment_not_found", "That payment does not exist.");
    }

    const [allocation] = await tx
      .select({
        id: paymentAllocations.id,
        pledgeId: paymentAllocations.pledgeId,
        amountMinor: paymentAllocations.amountMinor,
        reversedAt: paymentAllocations.reversedAt,
      })
      .from(paymentAllocations)
      .where(
        and(
          eq(paymentAllocations.id, allocationId),
          // Scoped to the payment in the URL, so a mistyped path cannot reach
          // an allocation belonging to some other payment.
          eq(paymentAllocations.paymentId, payment.id),
        ),
      )
      .for("update")
      .limit(1);

    if (!allocation) {
      throw notFound(
        "allocation_not_found",
        "That allocation does not exist on this payment.",
      );
    }

    if (allocation.reversedAt !== null) {
      throw conflict(
        "allocation_already_reversed",
        "That allocation has already been reversed.",
      );
    }

    const [pledge] = await tx
      .select({
        id: pledges.id,
        reference: pledges.reference,
        amountMinor: pledges.amountMinor,
        status: pledges.status,
      })
      .from(pledges)
      .where(eq(pledges.id, allocation.pledgeId))
      .for("update")
      .limit(1);

    if (!pledge) {
      throw notFound("pledge_not_found", "That pledge does not exist.");
    }

    const now = new Date();

    const [reversed] = await tx
      .update(paymentAllocations)
      .set({ reversedAt: now, reversedBy: adminId })
      .where(
        and(
          eq(paymentAllocations.id, allocation.id),
          // Repeats the condition, so two admins clicking remove at the same
          // moment produce one reversal and one clear conflict.
          isNull(paymentAllocations.reversedAt),
        ),
      )
      .returning({ reversedAt: paymentAllocations.reversedAt });

    if (!reversed?.reversedAt) {
      throw conflict(
        "allocation_already_reversed",
        "That allocation has already been reversed.",
      );
    }

    await tx.insert(auditLog).values({
      actorType: "admin",
      actorId: adminId,
      action: "payment.deallocated",
      entity: "payment_allocation",
      entityId: allocation.id,
      // The before is the allocation as it stood. It is what makes this row
      // readable on its own, without joining back to a table whose figures
      // have since moved.
      before: {
        paymentId: payment.id,
        paymentRef: payment.externalRef,
        paymentMethod: payment.method,
        pledgeId: pledge.id,
        pledgeReference: pledge.reference,
        amountMinor: allocation.amountMinor.toString(),
        currency: payment.currency,
      },
      after: { reversedAt: reversed.reversedAt.toISOString() },
      ip: request?.ip ?? null,
      userAgent: request?.userAgent ?? null,
    });

    /*
     * Fulfilled was only ever reached by an allocation that closed the balance,
     * and a reversal always reopens it. So a fulfilled pledge goes back to
     * verified, which is where allocate() found it. verified_at is left alone:
     * the approval still happened and its date is still true.
     */
    const shouldRevert = pledge.status === "fulfilled";
    let pledgeStatus = pledge.status as PledgeStatus;

    if (shouldRevert) {
      const [updated] = await tx
        .update(pledges)
        .set({ status: "verified", updatedAt: now })
        .where(and(eq(pledges.id, pledge.id), eq(pledges.status, "fulfilled")))
        .returning({ status: pledges.status });

      if (!updated) {
        throw conflict(
          "invalid_transition",
          `${pledge.reference} is no longer fulfilled.`,
        );
      }

      pledgeStatus = updated.status as PledgeStatus;

      await tx.insert(auditLog).values({
        actorType: "admin",
        actorId: adminId,
        action: "pledge.unfulfilled",
        entity: "pledge",
        entityId: pledge.id,
        before: { status: "fulfilled" },
        after: {
          status: updated.status,
          reference: pledge.reference,
          allocationId: allocation.id,
        },
        ip: request?.ip ?? null,
        userAgent: request?.userAgent ?? null,
      });
    }

    // Read back rather than subtract, so what is returned is what the views
    // will say once this transaction commits.
    const allocatedAfter = await allocatedForPayment(tx, payment.id);
    const paidAfter = await paidForPledge(tx, pledge.id);

    return {
      allocationId: allocation.id,
      paymentId: payment.id,
      pledgeId: pledge.id,
      pledgeReference: pledge.reference,
      amountMinor: allocation.amountMinor,
      currency: payment.currency,
      reversedAt: reversed.reversedAt,
      paymentAmountMinor: payment.amountMinor,
      paymentAllocatedMinor: allocatedAfter,
      paymentUnallocatedMinor: payment.amountMinor - allocatedAfter,
      pledgeAmountMinor: pledge.amountMinor,
      pledgePaidMinor: paidAfter,
      pledgeOutstandingMinor: pledge.amountMinor - paidAfter,
      pledgeStatus,
      pledgeReverted: shouldRevert,
    };
  });
}

/* ---------------------------------------------------------------------------
 * Reading the payment book.
 * ------------------------------------------------------------------------- */

/**
 * How much of a payment has found a home.
 *
 * Derived, never stored. A counter column would be one more thing that can
 * disagree with payment_allocations, and CLAUDE.md is explicit that totals are
 * read from the database rather than kept in a field somebody has to remember
 * to update.
 */
export type AllocationStatus = "unallocated" | "partial" | "fully_allocated";

export type AdminPaymentRow = {
  id: string;
  paidAt: Date;
  method: string;
  externalRef: string | null;
  amountMinor: bigint;
  currency: string;
  payerName: string | null;
  status: string;
  allocatedMinor: bigint;
  unallocatedMinor: bigint;
  allocationStatus: AllocationStatus;
};

type PaymentListRow = {
  id: string;
  paid_at: string;
  method: string;
  external_ref: string | null;
  amount_minor: string;
  currency: string;
  payer_name_raw: string | null;
  status: string;
  allocated_minor: string;
  allocation_status: AllocationStatus;
};

/**
 * The treasurer's payment book, newest money first.
 *
 * The allocation status is computed in SQL rather than in TypeScript, so the
 * comparison happens in the same place and the same integer arithmetic as the
 * sum it depends on. Reversed allocations are excluded, exactly as
 * v_pledge_balances excludes them, so a corrected match frees the payment here
 * too instead of leaving it looking permanently spent.
 *
 * Keyset paginated on (paid_at, id) descending. A payment recorded while the
 * treasurer is reading page two cannot push a row across the boundary, which is
 * the failure offset pagination has on a live campaign.
 */
export async function listForAdmin(
  db: Db,
  args: { campaignSlug: string; limit?: number; cursor?: string | null },
): Promise<Page<AdminPaymentRow>> {
  const limit = pageSize(args.limit);
  const cursor = decodeCursor(args.cursor);

  /*
   * The row comparison is what makes this a keyset. (paid_at, id) < (k, i)
   * compares the pair lexicographically in one indexable expression, which is
   * both shorter and more correct than spelling out the "or equal and id less
   * than" form by hand.
   */
  const result = await db.execute(sql`
    select p.id,
           p.paid_at,
           p.method,
           p.external_ref,
           p.amount_minor,
           p.currency,
           p.payer_name_raw,
           p.status,
           coalesce(a.allocated_minor, 0) as allocated_minor,
           case
             when coalesce(a.allocated_minor, 0) = 0 then 'unallocated'
             when coalesce(a.allocated_minor, 0) >= p.amount_minor
               then 'fully_allocated'
             else 'partial'
           end as allocation_status
    from payments p
    join campaigns c on c.id = p.campaign_id
    left join lateral (
      select sum(amount_minor) as allocated_minor
      from payment_allocations
      where payment_id = p.id
        and reversed_at is null
    ) a on true
    where c.slug = ${args.campaignSlug}
      and (
        ${cursor === null}::boolean
        or (p.paid_at, p.id) < (${cursor?.key ?? null}::timestamptz,
                                ${cursor?.id ?? null}::uuid)
      )
    order by p.paid_at desc, p.id desc
    limit ${limit + 1}
  `);

  const rows = (result.rows as PaymentListRow[]).map((row) => {
    const amountMinor = BigInt(row.amount_minor);
    const allocatedMinor = BigInt(row.allocated_minor);

    return {
      id: row.id,
      paidAt: new Date(row.paid_at),
      method: row.method,
      externalRef: row.external_ref,
      amountMinor,
      currency: row.currency,
      payerName: row.payer_name_raw,
      status: row.status,
      allocatedMinor,
      // Floored at zero. The trigger makes an over allocation impossible, but a
      // negative remainder on a screen would be a worse way to find that out.
      unallocatedMinor:
        amountMinor > allocatedMinor ? amountMinor - allocatedMinor : 0n,
      allocationStatus: row.allocation_status,
    };
  });

  return toPage(rows, limit, (row) => ({
    key: row.paidAt.toISOString(),
    id: row.id,
  }));
}
