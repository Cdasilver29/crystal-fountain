import { and, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { Db } from "@/db";
import {
  auditLog,
  campaigns,
  pledgeIncrements,
  pledgers,
  pledges,
} from "@/db/schema";
import {
  conflict,
  notFound,
  rejected,
  ServiceError,
  tooManyRequests,
} from "@/server/errors";
import { kesToMinor } from "@/server/money";
import {
  isTurnstileConfigured,
  verify as verifyTurnstile,
  type TurnstileKeys,
} from "@/server/services/turnstile";
import {
  decodeCursor,
  pageSize,
  toPage,
  type Page,
} from "@/server/pagination";
import { escapeLike } from "@/server/sql";
import {
  instalmentMinor,
  PRIVACY_VERSION,
  PUBLIC_TOKEN_LENGTH,
  type CreatePledgeInput,
  type PledgeChannel,
  type PledgeFrequency,
  type PledgeIntent,
  type PledgeStatus,
  type RedemptionChoice,
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

/**
 * Everything the service needs to decide whether a submission is trustworthy
 * and whether it may skip the treasurer.
 *
 * The keys and the limit arrive as data rather than being read from the
 * environment here, so the policy is testable without one and the route handler
 * stays the only place that knows where configuration comes from.
 *
 * Leaving this off entirely is the safe default and not a bypass: a submission
 * with no security context is never auto approved and lands as pending, which
 * is exactly how every pledge behaved before auto approval existed.
 */
export type PledgeSecurityArgs = {
  /** The token the Turnstile widget produced, as the client sent it. */
  token?: string | null;
  keys: TurnstileKeys;
  /**
   * Whether running with Turnstile switched off is permitted. False in
   * production, where absent keys are a failed deploy rather than an open door.
   */
  bypassAllowed: boolean;
  /** Whole shillings. A pledge total under this is verified without a person. */
  autoApproveLimitKes: number;
};

export type CreatePledgeArgs = {
  input: CreatePledgeInput;
  campaignSlug: string;
  channel?: PledgeChannel;
  request?: RequestContext;
  security?: PledgeSecurityArgs;
};

/** How many submissions one phone number may make in the window. */
export const PLEDGE_RATE_LIMIT = 5;

/** The window that limit is counted over. */
export const PLEDGE_RATE_WINDOW_SECONDS = 60 * 60;

export type CreatePledgeResult = {
  pledgeId: string;
  reference: string;
  publicToken: string;
  /** The cumulative total on the pledge, after this submission. */
  amountMinor: bigint;
  /** What this submission added. The same as amountMinor for a first pledge. */
  addedMinor: bigint;
  /** The total before this submission, or null when the pledge is new. */
  previousAmountMinor: bigint | null;
  /** True when this added to a pledge that was already there. */
  isAddition: boolean;
  /**
   * True when this submission was verified on the spot rather than left for the
   * treasurer. The caller uses it to decide whether the campaign total just
   * moved and the cache needs revalidating.
   */
  autoApproved: boolean;
  currency: string;
  status: PledgeStatus;
  intent: PledgeIntent;
  createdAt: Date;
};

/**
 * The statuses a pledge can be in and still accumulate.
 *
 * A fulfilled pledge has been paid off, and a cancelled or void one is not a
 * promise any more, so neither takes an addition: the next submission from that
 * phone number starts a fresh pledge with a fresh reference. This list is the
 * one the partial unique index in migration 0005 is built on, and the two have
 * to stay in step.
 */
const ACCUMULATING_STATUSES = ["pending", "verified"] as const;

/** The unique index that stops one person holding two live pledges. */
const ONE_LIVE_PLEDGE_INDEX = "pledges_one_live_per_pledger_idx";

function isOneLivePledgeViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; constraint?: unknown };
  return (
    candidate.code === "23505" && candidate.constraint === ONE_LIVE_PLEDGE_INDEX
  );
}

/**
 * Records a pledge, accumulating onto the pledger's existing one.
 *
 * The phone number is the identity key, so a second submission from a number
 * that already has a live pledge is not a second pledge. It adds to the amount
 * on the pledge that is already there and hands back the same reference, the
 * same public token and therefore the same QR code. One person, one reference.
 *
 * Either way the submission also writes a pledge_increments row, and the
 * deferred constraint trigger from migration 0005 refuses the commit unless the
 * pledge amount equals the sum of its increments. CLAUDE.md: corrections are new
 * rows, not edits, and a total that only ever got UPDATEd would leave nothing to
 * reconcile against.
 *
 * One transaction covering all of it: find or create the pledger, find or create
 * the pledge, write the increment, append the audit row. If any step fails, none
 * of it happened.
 *
 * The retry covers one narrow race. Two submissions from the same number
 * arriving together can both find no existing pledge, because there is no row
 * yet to lock, and both go on to insert one. The unique index rejects the loser,
 * and running it again finds the pledge the winner just committed and
 * accumulates onto it, which is what the pledger asked for in the first place.
 */
export async function create(
  db: Db,
  args: CreatePledgeArgs,
): Promise<CreatePledgeResult> {
  // Before the transaction, deliberately. Asking Cloudflare is a network round
  // trip, and holding a database transaction open across one would lock the
  // pledger's row for as long as somebody else's service takes to answer.
  const trusted = await checkSecurity(args.security, args.request);

  try {
    return await createOnce(db, args, trusted);
  } catch (error) {
    if (!isOneLivePledgeViolation(error)) throw error;
    return createOnce(db, args, trusted);
  }
}

/**
 * Whether this submission has cleared the bot check.
 *
 * Returns false rather than throwing when there is no security context at all,
 * because that is a caller with no opinion, not a failed check. It throws only
 * for a submission that was actually refused, or for a configuration that
 * cannot be honoured safely.
 */
async function checkSecurity(
  security: PledgeSecurityArgs | undefined,
  request: RequestContext | undefined,
): Promise<boolean> {
  if (!security) return false;

  // Throws on a half configured pair rather than picking one of two bad guesses.
  if (!isTurnstileConfigured(security.keys)) {
    if (!security.bypassAllowed) {
      throw new ServiceError(
        "turnstile_misconfigured",
        "The security check is not configured. A pledge cannot be recorded until it is.",
        500,
      );
    }
    // A laptop with no Cloudflare account. Verification is skipped, and a
    // pledge under the limit is still approved, so the local form behaves the
    // way the deployed one does.
    return true;
  }

  const result = await verifyTurnstile({
    token: security.token,
    secretKey: security.keys.secretKey!,
    ip: request?.ip,
  });

  if (!result.ok) {
    // Cloudflare's codes are for us, not for the pledger. Somebody who has just
    // typed their name and their phone number gets told what to do next.
    console.warn("turnstile refused a pledge", result.errorCodes);
    throw rejected(
      "turnstile_failed",
      "The security check did not pass. Please complete it again and resubmit.",
    );
  }

  return true;
}

async function createOnce(
  db: Db,
  args: CreatePledgeArgs,
  trusted: boolean,
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
    const addedMinor = kesToMinor(input.amountKes);

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

    /*
     * Five submissions an hour from one phone number.
     *
     * Counted off pledge_increments, because an increment is exactly one
     * submission and there is no separate attempts table to keep in step with
     * reality. Counting from the database rather than memory means the limit
     * holds across every serverless instance and survives a redeploy, which an
     * in process counter would not.
     *
     * Inside the transaction and after the pledger is upserted, so two
     * submissions racing each other cannot both read a count of four.
     */
    const recent = await tx.execute(sql`
      select count(*)::int as submissions
      from pledge_increments i
      join pledges p on p.id = i.pledge_id
      where p.pledger_id = ${pledger.id}::uuid
        and i.created_at > now() - make_interval(secs => ${PLEDGE_RATE_WINDOW_SECONDS})
    `);

    const submissions = (recent.rows[0] as { submissions: number }).submissions;

    if (submissions >= PLEDGE_RATE_LIMIT) {
      throw tooManyRequests(
        "pledge_rate_limited",
        `That number has recorded ${PLEDGE_RATE_LIMIT} pledges in the last hour. Please wait a little while, or call the treasurer.`,
      );
    }

    /*
     * Locked for update, so a second submission from the same person waits here
     * rather than reading a total that is about to change underneath it. The
     * lock is what makes read then add then write safe. It does nothing when
     * there is no row yet, which is what the retry above is for.
     */
    const [existing] = await tx
      .select({
        id: pledges.id,
        amountMinor: pledges.amountMinor,
        status: pledges.status,
      })
      .from(pledges)
      .where(
        and(
          eq(pledges.campaignId, campaign.id),
          eq(pledges.pledgerId, pledger.id),
          inArray(pledges.status, [...ACCUMULATING_STATUSES]),
        ),
      )
      .for("update")
      .limit(1);

    const returning = {
      id: pledges.id,
      reference: pledges.reference,
      publicToken: pledges.publicToken,
      amountMinor: pledges.amountMinor,
      currency: pledges.currency,
      status: pledges.status,
      intent: pledges.intent,
      createdAt: pledges.createdAt,
    };

    /*
     * Whether the treasurer needs to look at this.
     *
     * The test is the whole pledge total, not what this submission added, so
     * five separate submissions cannot walk past a threshold one submission
     * would have been held at. That has a consequence worth knowing: an
     * addition that carries an already verified pledge over the limit puts the
     * whole pledge back to pending, and it leaves the public total until the
     * treasurer approves it. Holding the larger figure for review is the point
     * of having a limit at all.
     *
     * Without a security context there is nothing to trust, so nothing is
     * approved and every pledge lands as pending, exactly as it did before.
     */
    const previousMinor = existing ? existing.amountMinor : null;
    const total = previousMinor === null ? addedMinor : previousMinor + addedMinor;
    const limitMinor = args.security
      ? kesToMinor(args.security.autoApproveLimitKes)
      : 0n;
    const autoApproved = trusted && total < limitMinor;
    const status: PledgeStatus = autoApproved ? "verified" : "pending";
    const verifiedAt = autoApproved ? now : null;

    /*
     * The redemption plan, worked out here rather than taken from the client.
     *
     * The frequency is what decides, so intent can never disagree with the
     * frequency column beside it. The instalment amount is derived from the
     * whole pledge total and not from what this submission added: somebody who
     * pledges 1,000,000 and later adds 4,000,000 is paying off 5,000,000 over
     * the three years, and quoting them a plan for the addition alone would be
     * wrong.
     */
    const redemption: RedemptionChoice = input.installmentFrequency ?? "one_off";
    const intent: PledgeIntent =
      redemption === "one_off" ? "one_off" : "installment";
    const installmentFrequency =
      redemption === "one_off" ? null : redemption;
    const installmentAmountMinor = instalmentMinor(total, redemption);

    let pledge;

    if (existing) {
      /*
       * Adding to the pledge that is already there.
       *
       * The reference and the public token are deliberately not touched.
       * Somebody may have the first QR code saved on their phone or printed on
       * a card, and it has to keep resolving to the same pledge showing the new
       * total.
       *
       * The intent moves to whatever was chosen this time, because a redemption
       * plan describes how the whole pledge will be paid and the pledger has
       * just said how they intend to pay the larger figure.
       */
      const previous = existing.amountMinor;

      [pledge] = await tx
        .update(pledges)
        .set({
          amountMinor: total,
          intent,
          installmentFrequency,
          installmentAmountMinor,
          status,
          verifiedAt,
          updatedAt: now,
        })
        .where(eq(pledges.id, existing.id))
        .returning(returning);

      await tx.insert(auditLog).values({
        actorType: "public",
        action: "pledge.increased",
        entity: "pledge",
        entityId: pledge.id,
        // jsonb cannot carry a bigint, so every amount goes in as a string. It
        // is still minor units and it is still exact.
        before: {
          amountMinor: previous.toString(),
          status: existing.status,
        },
        after: {
          reference: pledge.reference,
          previousAmountMinor: previous.toString(),
          addedMinor: addedMinor.toString(),
          amountMinor: total.toString(),
          currency: pledge.currency,
          status: pledge.status,
          intent: pledge.intent,
          channel,
          category: input.category ?? null,
          tier: input.tier ?? null,
          autoApproved,
          heldForReview: !autoApproved && trusted,
          campaignId: campaign.id,
          pledgerId: pledger.id,
        },
        ip: request?.ip ?? null,
        userAgent: request?.userAgent ?? null,
      });
    } else {
      /*
       * The reference comes from next_pledge_reference() evaluated inside the
       * insert statement, so there is no read then write window in application
       * code and two simultaneous pledges cannot be handed the same number.
       * See migration 0000.
       */
      [pledge] = await tx
        .insert(pledges)
        .values({
          campaignId: campaign.id,
          pledgerId: pledger.id,
          reference: sql`next_pledge_reference()`,
          publicToken: nanoid(PUBLIC_TOKEN_LENGTH),
          amountMinor: addedMinor,
          intent,
          installmentFrequency,
          installmentAmountMinor,
          status,
          verifiedAt,
          channel,
        })
        .returning(returning);

      await tx.insert(auditLog).values({
        actorType: "public",
        action: "pledge.created",
        entity: "pledge",
        entityId: pledge.id,
        after: {
          reference: pledge.reference,
          amountMinor: pledge.amountMinor.toString(),
          currency: pledge.currency,
          status: pledge.status,
          intent: pledge.intent,
          channel,
          category: input.category ?? null,
          tier: input.tier ?? null,
          autoApproved,
          heldForReview: !autoApproved && trusted,
          campaignId: campaign.id,
          pledgerId: pledger.id,
        },
        ip: request?.ip ?? null,
        userAgent: request?.userAgent ?? null,
      });
    }

    /*
     * A second row for the approval itself.
     *
     * The created or increased row says a pledge happened; this one says why it
     * counts toward the public total without anybody having looked at it. They
     * are two different facts, and an approval that only ever appeared as a
     * field inside another row would be invisible on the audit screen, which is
     * where the treasurer goes to ask exactly that question. CLAUDE.md: every
     * write that changes what the congregation sees leaves a trail.
     */
    if (autoApproved) {
      await tx.insert(auditLog).values({
        actorType: "system",
        action: "pledge.auto_approved",
        entity: "pledge",
        entityId: pledge.id,
        before: { status: existing ? existing.status : "pending" },
        after: {
          reference: pledge.reference,
          status: pledge.status,
          amountMinor: total.toString(),
          limitMinor: limitMinor.toString(),
          verifiedAt: verifiedAt?.toISOString() ?? null,
          turnstile: isTurnstileConfigured(args.security!.keys)
            ? "verified"
            : "not configured",
        },
        ip: request?.ip ?? null,
        userAgent: request?.userAgent ?? null,
      });
    }

    /*
     * What the total is made of. Written for a first pledge as much as for an
     * addition, so the sum of a pledge's increments is always its amount and
     * the trigger has something to hold true.
     */
    await tx.insert(pledgeIncrements).values({
      pledgeId: pledge.id,
      amountMinor: addedMinor,
      channel,
      category: input.category ?? null,
      tier: input.tier ?? null,
      createdAt: now,
    });

    return {
      pledgeId: pledge.id,
      reference: pledge.reference,
      publicToken: pledge.publicToken,
      amountMinor: pledge.amountMinor,
      addedMinor,
      previousAmountMinor: previousMinor,
      isAddition: Boolean(existing),
      autoApproved,
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
  /** Null on a one off pledge. */
  installmentFrequency: PledgeFrequency | null;
  /** What one instalment comes to, in minor units. Null on a one off pledge. */
  installmentAmountMinor: bigint | null;
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
      installmentFrequency: pledges.installmentFrequency,
      installmentAmountMinor: pledges.installmentAmountMinor,
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
    installmentFrequency: row.installmentFrequency as PledgeFrequency | null,
    installmentAmountMinor: row.installmentAmountMinor,
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

type PledgeListRow = {
  id: string;
  reference: string;
  full_name: string;
  amount_minor: string;
  currency: string;
  status: string;
  created_at: string;
};

export type ListPledgesArgs = {
  campaignSlug: string;
  /** Free text, matched exactly as the search endpoint matches it. */
  q?: string | null;
  /** One status, or null for every status. */
  status?: PledgeStatus | null;
  limit?: number;
  cursor?: string | null;
};

/**
 * Pledges for the admin screen, newest first, filtered and paginated.
 *
 * This is the one place a pledger's name is returned alongside an amount, and
 * it is behind admin auth. No phone number and no email: the screen filters on
 * the phone but never shows it, because approving a pledge does not need it.
 *
 * Keyset paginated on (created_at, id) descending, which replaces the cap this
 * had before. The filters are part of the query rather than something applied
 * to a page after it is fetched, so a page is always a full page and the
 * cursor stays meaningful. A cursor is only valid for the filters it was
 * produced under, which is why changing a filter clears it.
 */
export async function listForAdmin(
  db: Db,
  args: ListPledgesArgs,
): Promise<Page<AdminPledgeRow>> {
  const limit = pageSize(args.limit);
  const cursor = decodeCursor(args.cursor);

  const term = args.q?.trim() ?? "";
  // Below the search endpoint's own minimum the term is ignored rather than
  // matched on, so a single stray character does not empty the screen.
  const patterns = term.length >= 2 ? searchPatterns(term) : null;
  const status = args.status ?? null;

  const result = await db.execute(sql`
    select p.id,
           p.reference,
           g.full_name,
           p.amount_minor,
           p.currency,
           p.status,
           p.created_at
    from pledges p
    join pledgers g on g.id = p.pledger_id
    join campaigns c on c.id = p.campaign_id
    where c.slug = ${args.campaignSlug}
      and (${status}::text is null or p.status = ${status}::pledge_status)
      and ${patterns ? matchesTerm(patterns) : sql`true`}
      and (
        ${cursor === null}::boolean
        or (p.created_at, p.id) < (${cursor?.key ?? null}::timestamptz,
                                   ${cursor?.id ?? null}::uuid)
      )
    order by p.created_at desc, p.id desc
    limit ${limit + 1}
  `);

  const rows = (result.rows as PledgeListRow[]).map((row) => ({
    id: row.id,
    reference: row.reference,
    fullName: row.full_name,
    amountMinor: BigInt(row.amount_minor),
    currency: row.currency,
    status: row.status as PledgeStatus,
    createdAt: new Date(row.created_at),
  }));

  return toPage(rows, limit, (row) => ({
    key: row.createdAt.toISOString(),
    id: row.id,
  }));
}

/* ---------------------------------------------------------------------------
 * Finding a pledge, for the treasurer matching a payment to it.
 * ------------------------------------------------------------------------- */

/** Why a row came back. Also the ranking, best first. */
export type PledgeMatchReason = "reference" | "phone" | "name";

export type PledgeSearchResult = {
  pledgeId: string;
  reference: string;
  fullName: string;
  /** Masked unless the caller is allowed the whole number. Never null. */
  phone: string;
  amountMinor: bigint;
  paidMinor: bigint;
  outstandingMinor: bigint;
  status: PledgeStatus;
  matchReason: PledgeMatchReason;
};

type SearchRow = {
  id: string;
  reference: string;
  full_name: string;
  phone_e164: string;
  amount_minor: string;
  paid_minor: string;
  outstanding_minor: string;
  status: string;
  match_reason: PledgeMatchReason;
};

/**
 * Masks a phone number down to its last three digits.
 *
 * "+254 ••• ••• 678". Enough for a viewer to confirm they are looking at the
 * right person when the treasurer reads a number aloud, not enough to be a
 * contact detail. CLAUDE.md keeps whole numbers off public surfaces; a viewer
 * is not the public, but they also have no task that needs one.
 */
function maskPhone(e164: string): string {
  const last = e164.slice(-3);
  const prefix = e164.startsWith("+254") ? "+254" : "";
  return `${prefix} ••• ••• ${last}`.trim();
}

export type SearchPledgesArgs = {
  campaignSlug: string;
  /** What the treasurer typed. */
  q: string;
  limit?: number;
  /**
   * Whether the caller may see whole phone numbers. Decided by role in the
   * route handler and passed in, because a service knows nothing about roles.
   *
   * The masking happens here rather than in the handler on purpose: if the
   * service returned the full number and left masking to its callers, the day
   * somebody adds a second caller is the day a number leaks.
   */
  revealPhone: boolean;
};

export const SEARCH_LIMIT = 10;
export const MIN_PHONE_DIGITS = 4;

/**
 * Finds pledges by reference, phone or name.
 *
 * Three matches in one query, ranked, because the treasurer holding an M-Pesa
 * receipt does not know which of the three they have. A reference is exact and
 * beats everything. A phone is close to exact, since it is the identity key for
 * a pledger. A name is a guess and comes last.
 *
 * The phone match is a suffix, because a payer writes 0712 345 678 and the
 * column holds +254712345678, and because the treasurer often has only the last
 * few digits off a slip. Four digits is the floor; below that it would match
 * most of the congregation.
 */
/** The three LIKE patterns one search term turns into. */
export type SearchPatterns = {
  referencePrefix: string;
  nameContains: string;
  /** Null when the term holds too few digits to be a phone number. */
  phoneSuffix: string | null;
};

/**
 * Turns what somebody typed into the patterns both callers match on.
 *
 * Shared by search(), which the allocate panel calls, and listForAdmin(), which
 * the pledge list filters with. One definition, so a term cannot mean one thing
 * in the search box on one screen and something else on another.
 */
export function searchPatterns(term: string): SearchPatterns {
  const escaped = escapeLike(term);

  /*
   * Digits only, so "0712 345 678" and "+254 712 345 678" both reduce to
   * something the column ends with. Null when there are too few to be
   * meaningful, and the phone branch then matches nothing rather than
   * everything.
   */
  const digits = term.replace(/\D/g, "");

  return {
    // References are stored upper case, so the prefix is compared upper case.
    referencePrefix: `${escaped.toUpperCase()}%`,
    nameContains: `%${escaped}%`,
    phoneSuffix:
      digits.length >= MIN_PHONE_DIGITS ? `%${escapeLike(digits)}` : null,
  };
}

/**
 * The condition that decides whether a pledge matches the term.
 *
 * Written against the aliases p (pledges) and g (pledgers), so every query
 * using it has to name its tables the same way.
 */
function matchesTerm(patterns: SearchPatterns) {
  return sql`(
    p.reference like ${patterns.referencePrefix} escape '\\'
    or (${patterns.phoneSuffix}::text is not null
        and g.phone_e164 like ${patterns.phoneSuffix} escape '\\')
    or g.full_name ilike ${patterns.nameContains} escape '\\'
  )`;
}

export async function search(
  db: Db,
  args: SearchPledgesArgs,
): Promise<PledgeSearchResult[]> {
  const term = args.q.trim();

  if (term === "") return [];

  const limit = Math.min(args.limit ?? SEARCH_LIMIT, SEARCH_LIMIT);
  const { referencePrefix, nameContains, phoneSuffix } = searchPatterns(term);

  const result = await db.execute(sql`
    select p.id,
           p.reference,
           g.full_name,
           g.phone_e164,
           b.amount_minor,
           b.paid_minor,
           b.outstanding_minor,
           p.status,
           case
             when p.reference like ${referencePrefix} escape '\\' then 'reference'
             when ${phoneSuffix}::text is not null
                  and g.phone_e164 like ${phoneSuffix} escape '\\' then 'phone'
             else 'name'
           end as match_reason
    from pledges p
    join pledgers g on g.id = p.pledger_id
    join campaigns c on c.id = p.campaign_id
    join v_pledge_balances b on b.pledge_id = p.id
    where c.slug = ${args.campaignSlug}
      and (
        p.reference like ${referencePrefix} escape '\\'
        or (${phoneSuffix}::text is not null
            and g.phone_e164 like ${phoneSuffix} escape '\\')
        or g.full_name ilike ${nameContains} escape '\\'
      )
    order by case
               when p.reference like ${referencePrefix} escape '\\' then 1
               when ${phoneSuffix}::text is not null
                    and g.phone_e164 like ${phoneSuffix} escape '\\' then 2
               else 3
             end,
             p.created_at desc
    limit ${limit}
  `);

  return (result.rows as SearchRow[]).map((row) => ({
    pledgeId: row.id,
    reference: row.reference,
    fullName: row.full_name,
    phone: args.revealPhone ? row.phone_e164 : maskPhone(row.phone_e164),
    amountMinor: BigInt(row.amount_minor),
    paidMinor: BigInt(row.paid_minor),
    outstandingMinor: BigInt(row.outstanding_minor),
    status: row.status as PledgeStatus,
    matchReason: row.match_reason,
  }));
}
