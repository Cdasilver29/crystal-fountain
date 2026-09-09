import { eq } from "drizzle-orm";

import type { Db } from "@/db";
import { auditLog, campaigns, payments } from "@/db/schema";
import type { RecordPaymentInput } from "@/server/contracts/payments";
import { conflict, notFound } from "@/server/errors";
import { kesToMinor } from "@/server/money";

/**
 * Money in.
 *
 * Recording a payment is the treasurer saying "this arrived". It is not an
 * allocation: nothing here touches a pledge. Matching a payment to the promise
 * it settles is a separate act with its own audit row, and it comes next.
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
