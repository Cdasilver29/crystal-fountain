import { z } from "zod";

import { kenyanPhone } from "./phone";

/**
 * The version of the privacy notice a pledger consents to. Bump this string
 * whenever the notice changes, so consent is always attributable to the wording
 * that was actually on screen.
 */
export const PRIVACY_VERSION = "2026-09-10";

/** Length of the public token used in /p/<token> and the QR code. */
export const PUBLIC_TOKEN_LENGTH = 22;

export const PLEDGE_INTENTS = ["one_off", "installment"] as const;
export type PledgeIntent = (typeof PLEDGE_INTENTS)[number];

export const PLEDGE_CHANNELS = [
  "web",
  "admin",
  "event",
  "sms",
  "import",
] as const;
export type PledgeChannel = (typeof PLEDGE_CHANNELS)[number];

/**
 * How a pledger plans to redeem an instalment pledge.
 *
 * Semi annual joined the list with the redemption plan dropdown. The database
 * check constraint on pledges.installment_frequency holds the same four values
 * and migration 0005 widened it, so the two cannot drift apart silently.
 */
export const PLEDGE_FREQUENCIES = [
  "monthly",
  "quarterly",
  "semi_annually",
  "annually",
] as const;
export type PledgeFrequency = (typeof PLEDGE_FREQUENCIES)[number];

/**
 * Which tab the pledger was on, and which tier the amount came from.
 *
 * Metadata for analytics and nothing else. Neither value changes what a pledge
 * does, what it is worth or how it is approved, and both are optional: an
 * amount typed into the custom field carries the tier "custom", and a pledge
 * recorded by the treasurer carries neither.
 */
export const PLEDGE_CATEGORIES = ["family", "individual"] as const;
export type PledgeCategory = (typeof PLEDGE_CATEGORIES)[number];

export const PLEDGE_TIERS = [
  "family_above_10m",
  "family_1m_to_10m",
  "family_below_1m",
  "individual_above_1m",
  "individual_100k_to_1m",
  "individual_below_100k",
  "custom",
] as const;
export type PledgeTier = (typeof PLEDGE_TIERS)[number];

export const PLEDGE_STATUSES = [
  "pending",
  "verified",
  "fulfilled",
  "cancelled",
  "void",
] as const;
export type PledgeStatus = (typeof PLEDGE_STATUSES)[number];

/**
 * Shillings, not cents. Converted to minor units in the money module.
 *
 * The ceiling is KES 1,000,000,000, which is 100000000000 minor units. It was
 * raised from KES 100,000,000 when the form started suggesting family pledges
 * of up to KES 10,000,000, so that one large family or corporate commitment is
 * not turned away by the form. The reference is unaffected: it encodes a
 * sequence and not an amount, so it stays inside its 12 characters.
 */
export const MIN_PLEDGE_KES = 100;
export const MAX_PLEDGE_KES = 1_000_000_000;

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

/**
 * The one contract for creating a pledge, shared by the client form and the
 * route handler. Client validation is convenience only. This same schema runs
 * server side on every request.
 *
 * No national ID field. v1 does not collect one, and no endpoint accepts one.
 */
export const createPledgeInput = z.object({
  fullName: z.string().trim().min(2, "Enter your full name."),

  phone: kenyanPhone,

  email: z.preprocess(
    emptyToUndefined,
    z.email("Enter a valid email address.").optional(),
  ),

  membershipNo: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .max(32, "Membership number is too long.")
      .optional(),
  ),

  amountKes: z
    .number("Enter an amount in shillings.")
    .int("Enter a whole number of shillings.")
    .min(MIN_PLEDGE_KES, `The smallest pledge is KES ${MIN_PLEDGE_KES}.`)
    .max(
      MAX_PLEDGE_KES,
      `The largest pledge this form accepts is KES ${MAX_PLEDGE_KES.toLocaleString("en-KE")}. Contact the treasurer for anything larger.`,
    ),

  intent: z.enum(PLEDGE_INTENTS),

  // Analytics metadata. Optional, because the treasurer's own entry point and
  // any older client have neither, and a pledge is perfectly valid without.
  category: z.enum(PLEDGE_CATEGORIES).optional(),
  tier: z.enum(PLEDGE_TIERS).optional(),

  // The three consents are separate and none of them is pre-ticked.
  // Recording the pledge is the only one that is required.
  recordConsent: z.literal(
    true,
    "Tick this to record your pledge, since it is what the record is based on.",
  ),
  contactConsent: z.boolean(),
  displayConsent: z.boolean(),
});

export type CreatePledgeInput = z.infer<typeof createPledgeInput>;

/** Path parameter contract for the public lookup routes. */
export const publicTokenInput = z.object({
  publicToken: z
    .string()
    .trim()
    .length(PUBLIC_TOKEN_LENGTH, "That pledge link is not valid."),
});

export type PublicTokenInput = z.infer<typeof publicTokenInput>;

export const approvePledgeInput = z.object({
  pledgeId: z.uuid("That is not a pledge id."),
});

export type ApprovePledgeInput = z.infer<typeof approvePledgeInput>;
