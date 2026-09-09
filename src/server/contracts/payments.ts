import { z } from "zod";

import { normalizeKenyanPhone } from "./phone";

/**
 * Recording a payment the treasurer has seen land.
 *
 * This is money, so the rules from CLAUDE.md apply in full: the amount crosses
 * as a whole number of shillings and becomes a bigint in minor units before it
 * reaches the database, and nothing here is ever a float.
 *
 * Unlike the pledge form, this is an admin surface. The payer's phone is
 * optional, because a bank slip does not carry one, and a name is whatever the
 * channel reported rather than something the payer typed about themselves.
 */

export const PAYMENT_METHODS = [
  "mpesa",
  "bank",
  "cash",
  "cheque",
  "other",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Methods that always carry a receipt or slip number worth demanding. */
export const METHODS_REQUIRING_REFERENCE: readonly PaymentMethod[] = [
  "mpesa",
  "bank",
];

export const MIN_PAYMENT_KES = 1;
export const MAX_PAYMENT_KES = 100_000_000;

/**
 * An optional phone. Blank stays blank; anything else has to be a real Kenyan
 * mobile, normalised to E.164 so two spellings never become two numbers.
 */
const optionalKenyanPhone = z
  .string()
  .trim()
  .transform((value, ctx) => {
    if (value === "") return null;

    const normalized = normalizeKenyanPhone(value);

    if (normalized === null) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a Kenyan mobile number, for example 0712 345 678.",
      });
      return z.NEVER;
    }

    return normalized;
  });

const optionalText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .transform((value) => (value === "" ? null : value));

export const recordPaymentInput = z
  .object({
    method: z.enum(PAYMENT_METHODS, "Choose how the money arrived."),

    /**
     * The M-Pesa receipt or bank slip. Uppercased, because M-Pesa receipts are
     * upper case and the unique index is case sensitive: MFF1F2G3H4 and
     * mff1f2g3h4 would otherwise both be storable as separate payments.
     */
    externalRef: z
      .string()
      .trim()
      .max(64, "That reference is too long.")
      .transform((value) => (value === "" ? null : value.toUpperCase())),

    amountKes: z
      .number("Enter an amount in shillings.")
      .int("Enter a whole number of shillings.")
      .min(MIN_PAYMENT_KES, `The smallest payment is KES ${MIN_PAYMENT_KES}.`)
      .max(
        MAX_PAYMENT_KES,
        `The largest payment this form accepts is KES ${MAX_PAYMENT_KES.toLocaleString("en-KE")}.`,
      ),

    payerName: optionalText(160, "That name is too long."),

    payerPhone: optionalKenyanPhone,

    /** What the payer typed as the account number. Used for matching later. */
    accountRef: optionalText(64, "That account reference is too long."),

    paidAt: z.iso
      .date("Enter the date the money arrived.")
      .refine(
        (value) => new Date(`${value}T00:00:00Z`) <= new Date(),
        "That date is in the future.",
      ),

    note: optionalText(1000, "That note is too long."),
  })
  .refine(
    (value) =>
      !METHODS_REQUIRING_REFERENCE.includes(value.method) ||
      value.externalRef !== null,
    {
      path: ["externalRef"],
      message:
        "An M-Pesa or bank payment needs its receipt or slip number, so it cannot be entered twice.",
    },
  );

export type RecordPaymentInput = z.infer<typeof recordPaymentInput>;

/**
 * Matching money to a promise.
 *
 * Allocation is the second half of the treasurer's job: a payment arrives, and
 * later somebody decides which pledge it settles. The amount is optional,
 * because the common case is "all of it", and the service works out the
 * default from the payment's unallocated remainder and the pledge's
 * outstanding balance.
 */

/** The largest payment the form accepts, in minor units. */
const MAX_PAYMENT_MINOR = BigInt(MAX_PAYMENT_KES) * 100n;

const DIGITS = /^[0-9]+$/;

/**
 * An amount in minor units.
 *
 * Accepted as a string or a whole number and returned as a bigint. JSON has no
 * bigint, so the wire carries minor units as a string by convention, but a
 * form posting a plain number should not be rejected for it. What is rejected
 * is anything that could have lost precision on the way: a float, an unsafe
 * integer, or a string that is not simply digits.
 */
const minorUnits = z
  .union([z.string(), z.number()])
  .transform((value, ctx) => {
    const invalid = (message: string) => {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    };

    if (typeof value === "number") {
      if (!Number.isSafeInteger(value)) {
        return invalid("Enter a whole number of cents.");
      }
      if (value <= 0) return invalid("Enter an amount greater than zero.");
      return BigInt(value);
    }

    const trimmed = value.trim();

    if (!DIGITS.test(trimmed)) {
      return invalid("Enter a whole number of cents.");
    }

    const parsed = BigInt(trimmed);

    if (parsed <= 0n) return invalid("Enter an amount greater than zero.");

    return parsed;
  })
  .refine(
    (value) => value <= MAX_PAYMENT_MINOR,
    `The largest amount this accepts is KES ${MAX_PAYMENT_KES.toLocaleString("en-KE")}.`,
  );

export const allocatePaymentInput = z.object({
  pledgeId: z.uuid("Choose a pledge to allocate this payment to."),

  /**
   * Optional. Left out, the service allocates the lesser of what is left on
   * the payment and what is outstanding on the pledge.
   */
  amountMinor: minorUnits.optional(),
});

export type AllocatePaymentInput = z.infer<typeof allocatePaymentInput>;

/** Path parameters for the allocation endpoints. Both are uuids or nothing. */
export const paymentPathParams = z.object({
  paymentId: z.uuid("That payment does not exist."),
});

export const allocationPathParams = z.object({
  paymentId: z.uuid("That payment does not exist."),
  allocationId: z.uuid("That allocation does not exist."),
});
