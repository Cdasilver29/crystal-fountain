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

/**
 * How long a pledge is understood to run.
 *
 * Three years, matching the commitment table the campaign has been presented
 * with from the start. Every instalment figure the form quotes is this number
 * divided down, so a member reading "per month" on the form and a member
 * reading the commitment table are looking at the same arithmetic.
 */
export const REDEMPTION_PERIOD_MONTHS = 36;

/** What the redemption dropdown offers. One off, or one of the frequencies. */
export const REDEMPTION_CHOICES = [
  "one_off",
  ...PLEDGE_FREQUENCIES,
] as const;
export type RedemptionChoice = (typeof REDEMPTION_CHOICES)[number];

export type RedemptionPlan = {
  /** The dropdown label. */
  label: string;
  /** How many payments the pledge is split into over the three years. */
  instalments: number;
  /** What to call those payments when counting them. */
  periodNoun: string;
  /** How to describe one of them. */
  eachLabel: string;
};

export const REDEMPTION_PLANS: Record<RedemptionChoice, RedemptionPlan> = {
  one_off: {
    label: "One-off payment",
    instalments: 1,
    periodNoun: "payment",
    eachLabel: "in one payment",
  },
  monthly: {
    label: "Monthly",
    instalments: REDEMPTION_PERIOD_MONTHS,
    periodNoun: "months",
    eachLabel: "per month",
  },
  quarterly: {
    label: "Quarterly",
    instalments: REDEMPTION_PERIOD_MONTHS / 3,
    periodNoun: "quarters",
    eachLabel: "per quarter",
  },
  semi_annually: {
    label: "Semi-annually",
    instalments: REDEMPTION_PERIOD_MONTHS / 6,
    periodNoun: "payments",
    eachLabel: "every six months",
  },
  annually: {
    label: "Annually",
    instalments: REDEMPTION_PERIOD_MONTHS / 12,
    periodNoun: "years",
    eachLabel: "per year",
  },
};

/**
 * What one instalment comes to, in minor units, or null for a one off pledge.
 *
 * Whole shillings, rounded up. Nobody pays 138,888 shillings and 89 cents by
 * M-Pesa, and rounding up rather than down means somebody who follows the plan
 * to the letter finishes having covered the pledge rather than a few shillings
 * short of it. The last payment is smaller in practice, which is the treasurer's
 * business and not the form's.
 *
 * All integer arithmetic on bigints. Nothing here turns money into a JavaScript
 * number, per CLAUDE.md.
 */
export function instalmentMinor(
  totalMinor: bigint,
  choice: RedemptionChoice,
): bigint | null {
  if (choice === "one_off") return null;

  const instalments = BigInt(REDEMPTION_PLANS[choice].instalments);
  const shillings = totalMinor / 100n;
  // Integer ceiling: (a + b - 1) / b.
  const perInstalment = (shillings + instalments - 1n) / instalments;

  return perInstalment * 100n;
}

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

  /*
   * Kept for the callers that already send it, but the frequency below is what
   * actually decides. A submission carrying a frequency is an instalment
   * pledge and one without is a one off, whatever intent says, so the two
   * columns cannot end up disagreeing with each other in the database.
   */
  intent: z.enum(PLEDGE_INTENTS),

  /*
   * How the pledger plans to redeem, when they picked something other than a
   * single payment. Optional, because one off is the default and sends nothing.
   *
   * The instalment amount is deliberately not accepted here. It is money, it is
   * derived from the pledge total, and the total can change under accumulation,
   * so the server works it out and the client is never asked to be right about
   * it.
   */
  installmentFrequency: z.enum(PLEDGE_FREQUENCIES).optional(),

  // Analytics metadata. Optional, because the treasurer's own entry point and
  // any older client have neither, and a pledge is perfectly valid without.
  category: z.enum(PLEDGE_CATEGORIES).optional(),
  tier: z.enum(PLEDGE_TIERS).optional(),

  /*
   * The Turnstile token, when the form rendered a widget to produce one.
   *
   * Optional here on purpose. Whether a token is required is a server side
   * decision that depends on whether Turnstile is configured, and the schema
   * has no way to know that. Making it required in the contract would only
   * break the local form, which legitimately has no widget, while doing nothing
   * to stop a robot that simply posts a token shaped string.
   */
  turnstileToken: z.preprocess(
    emptyToUndefined,
    z.string().max(4096).optional(),
  ),

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
