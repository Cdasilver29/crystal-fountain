import { and, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { Db } from "@/db";
import { auditLog, campaigns, pledgers, pledges } from "@/db/schema";
import { conflict, notFound } from "@/server/errors";
import { kesToMinor } from "@/server/money";
import {
  PRIVACY_VERSION,
  PUBLIC_TOKEN_LENGTH,
  type CreatePledgeInput,
  type PledgeChannel,
  type PledgeIntent,
  type PledgeStatus,
} from "@/server/contracts/pledges";

/**
 * Pledge services.
 *
 * Plain functions taking (db, input). Nothing here imports from next, touches
 * Request or Response, or reads cookies. Anything the domain needs about the
 * caller arrives as data on the input.
 */

/** Caller details recorded on the audit row. Supplied by the route handler. */
export type RequestContext = {
  /** Must be a valid IP or null. The audit_log column is inet. */
  ip?: string | null;
  userAgent?: string | null;
};

export type CreatePledgeArgs = {
  input: CreatePledgeInput;
  campaignSlug: string;
  channel?: PledgeChannel;
  request?: RequestContext;
};

export type CreatePledgeResult = {
  pledgeId: string;
  reference: string;
  publicToken: string;
  amountMinor: bigint;
  currency: string;
  status: PledgeStatus;
  intent: PledgeIntent;
  createdAt: Date;
};

/**
 * Records a pledge.
 *
 * One transaction covering: find or create the pledger, allocate the reference
 * and public token, insert the pledge as pending, append the audit row. If any
 * step fails, none of it happened.
 *
 * The reference comes from next_pledge_reference() evaluated inside the insert
 * statement, so there is no read then write window in application code and two
 * simultaneous pledges cannot be handed the same number. See migration 0000.
 */
export async function create(
  db: Db,
  args: CreatePledgeArgs,
): Promise<CreatePledgeResult> {
  const { input, campaignSlug, channel = "web", request } = args;

  return db.transaction(async (tx) => {
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

    const now = new Date();

    // The phone number is the identity key. A second pledge from the same
    // number updates the person rather than creating a duplicate, and the
    // upsert makes that safe under concurrent submissions.
    const consentFields = {
      fullName: input.fullName,
      email: input.email ?? null,
      membershipNo: input.membershipNo ?? null,
      // Only consented names are ever stored for public display.
      displayName: input.displayConsent ? input.fullName : null,
      displayConsent: input.displayConsent,
      contactConsent: input.contactConsent,
      privacyVersion: PRIVACY_VERSION,
      consentedAt: now,
    };

    const [pledger] = await tx
      .insert(pledgers)
      .values({ phoneE164: input.phone, ...consentFields })
      .onConflictDoUpdate({
        target: pledgers.phoneE164,
        set: { ...consentFields, updatedAt: now },
      })
      .returning({ id: pledgers.id });

    const [pledge] = await tx
      .insert(pledges)
      .values({
        campaignId: campaign.id,
        pledgerId: pledger.id,
        reference: sql`next_pledge_reference()`,
        publicToken: nanoid(PUBLIC_TOKEN_LENGTH),
        amountMinor: kesToMinor(input.amountKes),
        intent: input.intent,
        channel,
      })
      .returning({
        id: pledges.id,
        reference: pledges.reference,
        publicToken: pledges.publicToken,
        amountMinor: pledges.amountMinor,
        currency: pledges.currency,
        status: pledges.status,
        intent: pledges.intent,
        createdAt: pledges.createdAt,
      });

    await tx.insert(auditLog).values({
      actorType: "public",
      action: "pledge.created",
      entity: "pledge",
      entityId: pledge.id,
      // jsonb cannot carry a bigint, so the amount goes in as a string. It is
      // still minor units and it is still exact.
      after: {
        reference: pledge.reference,
        amountMinor: pledge.amountMinor.toString(),
        currency: pledge.currency,
        status: pledge.status,
        intent: pledge.intent,
        channel,
        campaignId: campaign.id,
        pledgerId: pledger.id,
      },
      ip: request?.ip ?? null,
      userAgent: request?.userAgent ?? null,
    });

    return {
      pledgeId: pledge.id,
      reference: pledge.reference,
      publicToken: pledge.publicToken,
      amountMinor: pledge.amountMinor,
      currency: pledge.currency,
      status: pledge.status as PledgeStatus,
      intent: pledge.intent as PledgeIntent,
      createdAt: pledge.createdAt,
    };
  });
}

export type ApprovePledgeArgs = {
  pledgeId: string;
  adminId?: string | null;
  request?: RequestContext;
};

export type ApprovePledgeResult = {
  pledgeId: string;
  reference: string;
  status: PledgeStatus;
  verifiedAt: Date | null;
};

/**
 * Moves a pledge from pending to verified, and appends the audit row.
 *
 * Any other starting status is rejected. Approving is what makes a pledge count
 * toward the public total, so the transition is guarded twice: the row is locked
 * for update while it is inspected, and the update itself repeats the pending
 * condition in its where clause. Two administrators clicking approve at the same
 * moment produce one verified pledge and one clear conflict, never two audit
 * rows claiming they each did it.
 */
export async function approve(
  db: Db,
  args: ApprovePledgeArgs,
): Promise<ApprovePledgeResult> {
  const { pledgeId, adminId = null, request } = args;

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: pledges.id, reference: pledges.reference, status: pledges.status })
      .from(pledges)
      .where(eq(pledges.id, pledgeId))
      .for("update")
      .limit(1);

    if (!current) {
      throw notFound("pledge_not_found", "That pledge does not exist.");
    }

    if (current.status !== "pending") {
      throw conflict(
        "invalid_transition",
        `A pledge can only be approved from pending. ${current.reference} is ${current.status}.`,
      );
    }

    const now = new Date();

    const [updated] = await tx
      .update(pledges)
      .set({ status: "verified", verifiedAt: now, updatedAt: now })
      .where(and(eq(pledges.id, pledgeId), eq(pledges.status, "pending")))
      .returning({
        id: pledges.id,
        reference: pledges.reference,
        status: pledges.status,
        verifiedAt: pledges.verifiedAt,
      });

    if (!updated) {
      throw conflict(
        "invalid_transition",
        `${current.reference} is no longer pending.`,
      );
    }

    await tx.insert(auditLog).values({
      actorType: "admin",
      actorId: adminId,
      action: "pledge.approved",
      entity: "pledge",
      entityId: updated.id,
      before: { status: current.status },
      after: {
        status: updated.status,
        verifiedAt: updated.verifiedAt?.toISOString() ?? null,
      },
      ip: request?.ip ?? null,
      userAgent: request?.userAgent ?? null,
    });

    return {
      pledgeId: updated.id,
      reference: updated.reference,
      status: updated.status as PledgeStatus,
      verifiedAt: updated.verifiedAt,
    };
  });
}

/** Everything the public confirmation and /p/<token> pages are allowed to see. */
export type PublicPledgeView = {
  reference: string;
  amountMinor: bigint;
  currency: string;
  status: PledgeStatus;
  intent: PledgeIntent;
  createdAt: Date;
  /** Null unless the pledger ticked the display consent box. */
  displayName: string | null;
};

/**
 * Looks a pledge up by its unguessable public token.
 *
 * The select list is the privacy guarantee: phone and email are not columns
 * this function can return, and the display name is dropped unless the pledger
 * consented to it. Never look a pledge up by reference for a public caller,
 * because the reference is sequential and trivially enumerable.
 */
export async function getByPublicToken(
  db: Db,
  args: { publicToken: string },
): Promise<PublicPledgeView | null> {
  const [row] = await db
    .select({
      reference: pledges.reference,
      amountMinor: pledges.amountMinor,
      currency: pledges.currency,
      status: pledges.status,
      intent: pledges.intent,
      createdAt: pledges.createdAt,
      displayName: pledgers.displayName,
      displayConsent: pledgers.displayConsent,
    })
    .from(pledges)
    .innerJoin(pledgers, eq(pledgers.id, pledges.pledgerId))
    .where(eq(pledges.publicToken, args.publicToken))
    .limit(1);

  if (!row) return null;

  return {
    reference: row.reference,
    amountMinor: row.amountMinor,
    currency: row.currency,
    status: row.status as PledgeStatus,
    intent: row.intent as PledgeIntent,
    createdAt: row.createdAt,
    displayName: row.displayConsent ? row.displayName : null,
  };
}

/** One row of the treasurer's pledge list. */
export type AdminPledgeRow = {
  id: string;
  reference: string;
  fullName: string;
  amountMinor: bigint;
  currency: string;
  status: PledgeStatus;
  createdAt: Date;
};

/**
 * Every pledge, newest first, for the admin screen.
 *
 * This is the one place a pledger's name is returned alongside an amount, and
 * it is behind admin auth. No phone number and no email, because approving a
 * pledge does not require either and the screen has no use for them.
 *
 * Capped rather than paginated. The realistic volume for this congregation is
 * single digit thousands, and PLAN.md section 13 calls for cursor pagination
 * when this screen grows past being a launch stopgap.
 */
export async function listForAdmin(
  db: Db,
  args: { campaignSlug: string; limit?: number },
): Promise<AdminPledgeRow[]> {
  const rows = await db
    .select({
      id: pledges.id,
      reference: pledges.reference,
      fullName: pledgers.fullName,
      amountMinor: pledges.amountMinor,
      currency: pledges.currency,
      status: pledges.status,
      createdAt: pledges.createdAt,
    })
    .from(pledges)
    .innerJoin(pledgers, eq(pledgers.id, pledges.pledgerId))
    .innerJoin(campaigns, eq(campaigns.id, pledges.campaignId))
    .where(eq(campaigns.slug, args.campaignSlug))
    .orderBy(desc(pledges.createdAt))
    .limit(Math.min(args.limit ?? 200, 500));

  return rows.map((row) => ({ ...row, status: row.status as PledgeStatus }));
}
