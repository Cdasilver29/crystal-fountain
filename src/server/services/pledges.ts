import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { Db } from "@/db";
import { auditLog, campaigns, pledgers, pledges } from "@/db/schema";
import { conflict, notFound } from "@/server/errors";
import { kesToMinor } from "@/server/money";
import {
  decodeCursor,
  pageSize,
  toPage,
  type Page,
} from "@/server/pagination";
import { escapeLike } from "@/server/sql";
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
