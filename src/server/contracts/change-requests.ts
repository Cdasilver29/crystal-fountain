import { z } from "zod";

import { kenyanPhone } from "./phone";
import {
  MAX_PLEDGE_KES,
  MIN_PLEDGE_KES,
  REDEMPTION_CHOICES,
  pledgeReference,
} from "./pledges";
import { MAX_PAYMENT_KES, MIN_PAYMENT_KES } from "./payments";

/**
 * What a pledger may ask to have changed about their pledge.
 *
 * Everything except an increase. The pledge form already handles that: it
 * recognises the phone number and adds to the pledge that is there, so an
 * increase needs no review and is never a request. Everything else either moves
 * a figure the congregation is watching or changes what is published about a
 * person, so it waits for an administrator.
 *
 * A discriminated union rather than one object with everything optional. Each
 * kind validates its own fields and only its own, so there is no shape in which
 * a name correction can carry a payment reference or a reduction can arrive
 * with no amount. The database says the same thing in check constraints, and
 * the two are deliberately both there: this one gives the pledger a sentence
 * they can act on, and that one is what holds when anything reaches the table
 * by another route.
 *
 * Every kind carries the /redeem pair, a reference and the phone number that
 * matches it. That pairing is the only authentication this feature has, which
 * is enough to ask for a change and deliberately not enough to make one.
 */

export const CHANGE_REQUEST_KINDS = [
  "reduce_amount",
  "change_plan",
  "correct_name",
  "payment_missing",
  "cancel_pledge",
] as const;

export type ChangeRequestKind = (typeof CHANGE_REQUEST_KINDS)[number];

export const CHANGE_REQUEST_STATUSES = [
  "pending",
  "approved",
  "declined",
  "closed",
] as const;

export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number];

/** How the queue describes each kind, wherever one has to be named. */
export const CHANGE_REQUEST_LABELS: Record<ChangeRequestKind, string> = {
  reduce_amount: "Reduce the amount",
  change_plan: "Change the payment plan",
  correct_name: "Correct the name",
  payment_missing: "Payment not reflected",
  cancel_pledge: "Cancel the pledge",
};

const MIN_REASON_LENGTH = 10;
const MAX_REASON_LENGTH = 1000;

const MIN_PLEDGE_MINOR = BigInt(MIN_PLEDGE_KES) * 100n;
const MAX_PLEDGE_MINOR = BigInt(MAX_PLEDGE_KES) * 100n;
const MIN_PAYMENT_MINOR = BigInt(MIN_PAYMENT_KES) * 100n;
const MAX_PAYMENT_MINOR = BigInt(MAX_PAYMENT_KES) * 100n;

const DIGITS = /^[0-9]+$/;

/**
 * An amount in minor units, arriving as a string or a whole number.
 *
 * JSON has no bigint, so minor units cross the wire as a string by convention,
 * but a form posting a plain number should not be turned away for it. What is
 * refused is anything that could already have lost precision on the way: a
 * float, an unsafe integer, or a string that is not simply digits. The same
 * rule the allocation contract keeps, for the same reason.
 *
 * Whole shillings only. Nobody pledges or pays a fraction of a shilling by
 * M-Pesa, and a figure with cents on it here would be a client having done
 * arithmetic it was not asked to do.
 */
function minorUnits(options: {
  min: bigint;
  max: bigint;
  tooSmall: string;
  tooLarge: string;
}) {
  return z
    .union([z.string(), z.number()])
    .transform((value, ctx) => {
      const invalid = (message: string) => {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      };

      let parsed: bigint;

      if (typeof value === "number") {
        if (!Number.isSafeInteger(value)) {
          return invalid("Enter a whole number of shillings.");
        }
        parsed = BigInt(value);
      } else {
        const trimmed = value.trim();
        if (!DIGITS.test(trimmed)) {
          return invalid("Enter a whole number of shillings.");
        }
        parsed = BigInt(trimmed);
      }

      if (parsed % 100n !== 0n) {
        return invalid("Enter a whole number of shillings.");
      }
      if (parsed < options.min) return invalid(options.tooSmall);
      if (parsed > options.max) return invalid(options.tooLarge);

      return parsed;
    });
}

/** The same bounds a pledge amount is held to, expressed in minor units. */
const pledgeAmountMinor = minorUnits({
  min: MIN_PLEDGE_MINOR,
  max: MAX_PLEDGE_MINOR,
  tooSmall: `The smallest pledge is KES ${MIN_PLEDGE_KES}.`,
  tooLarge: `The largest pledge this form accepts is KES ${MAX_PLEDGE_KES.toLocaleString("en-KE")}. Contact the treasurer for anything larger.`,
});

const paymentAmountMinor = minorUnits({
  min: MIN_PAYMENT_MINOR,
  max: MAX_PAYMENT_MINOR,
  tooSmall: `The smallest payment is KES ${MIN_PAYMENT_KES}.`,
  tooLarge: `The largest payment this accepts is KES ${MAX_PAYMENT_KES.toLocaleString("en-KE")}.`,
});

/**
 * What every request carries, whatever it asks for.
 *
 * The reason is required on all five. A treasurer reading a queue needs to know
 * why before they can decide anything, and a reduction or a cancellation with
 * no explanation is the one request nobody can act on. Ten characters is short
 * enough to type on a phone and long enough to stop "no" being a whole reason.
 */
const base = {
  reference: pledgeReference,
  contactPhoneE164: kenyanPhone,
  reason: z
    .string()
    .trim()
    .min(MIN_REASON_LENGTH, "Say a little more about why, in a sentence.")
    .max(MAX_REASON_LENGTH, "That is longer than this form accepts."),
};

export const changeRequestInput = z.discriminatedUnion("kind", [
  /*
   * Reducing. An increase is not here and never will be: the pledge form adds
   * to an existing pledge on its own, needs no review, and sending somebody
   * through a queue for it would be slower for them and more work for the
   * treasurer. See reduceAmountRefusal, which says so in the one place a
   * request could still try.
   */
  z.object({
    kind: z.literal("reduce_amount"),
    ...base,
    requestedAmountMinor: pledgeAmountMinor,
  }),

  z.object({
    kind: z.literal("change_plan"),
    ...base,
    requestedFrequency: z.enum(
      REDEMPTION_CHOICES,
      "Choose how you plan to pay.",
    ),
  }),

  z.object({
    kind: z.literal("correct_name"),
    ...base,
    requestedName: z
      .string()
      .trim()
      .min(2, "Enter the name as it should read.")
      .max(120, "That name is too long."),
  }),

  z.object({
    kind: z.literal("payment_missing"),
    ...base,
    /*
     * Upper cased, like payments.external_ref. The treasurer will match this
     * against the payments already recorded, and MFF1F2G3H4 typed in lower
     * case has to find the same row.
     */
    paymentReference: z
      .string()
      .trim()
      .min(1, "Enter the M-Pesa code or bank slip number.")
      .max(64, "That reference is too long.")
      .transform((value) => value.toUpperCase()),
    paymentAmountMinor,
    paymentPaidOn: z.iso
      .date("Enter the date you paid.")
      .refine(
        (value) => new Date(`${value}T00:00:00Z`) <= new Date(),
        "That date is in the future.",
      ),
  }),

  z.object({
    kind: z.literal("cancel_pledge"),
    ...base,
  }),
]);

export type ChangeRequestInput = z.infer<typeof changeRequestInput>;

export type ReduceAmountInput = Extract<
  ChangeRequestInput,
  { kind: "reduce_amount" }
>;

/* ---------------------------------------------------------------------------
 * Reading the queue.
 * ------------------------------------------------------------------------- */

/**
 * What the queue screen filters on.
 *
 * Everything is caught rather than refused, because these come off a query
 * string. A hand edited or stale filter in a bookmarked URL should quietly
 * show the default view, not a 500 on the screen the treasurer opens first.
 *
 * Pending is the default and not "all". This is a work queue: what it is for
 * is the things nobody has answered yet, and a screen that opened on a year of
 * history with the eleven live ones somewhere inside it would be a report
 * rather than a queue. The filter offers the rest.
 */
export const changeRequestListFilters = z.object({
  status: z.enum(["all", ...CHANGE_REQUEST_STATUSES]).catch("pending"),
  kind: z.enum(["all", ...CHANGE_REQUEST_KINDS]).catch("all"),
  cursor: z
    .string()
    .max(512)
    .catch("")
    .transform((value) => value || null),
});

export type ChangeRequestListFilters = z.infer<typeof changeRequestListFilters>;

/* ---------------------------------------------------------------------------
 * Answering one.
 * ------------------------------------------------------------------------- */

/** The shortest decision note that says anything. The same floor as a reason. */
export const MIN_DECISION_NOTE_LENGTH = 10;

/**
 * An administrator answering a request.
 *
 * A union on the decision rather than one object with an optional note,
 * because the note is required on one branch and not on the other, and a
 * single optional field could not express that.
 *
 * Declining needs a note. The pledger is told the answer, and "no" with
 * nothing after it is not an answer anybody can do anything with: they cannot
 * tell whether to ring the treasurer, correct something and ask again, or let
 * it go. Approving does not, because what was approved is already on the
 * record in full, and the change it produced is in the journal beside it.
 */
export const decideChangeRequestInput = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("approve"),
    note: z
      .string()
      .trim()
      .max(MAX_REASON_LENGTH, "That note is longer than this accepts.")
      .optional()
      .transform((value) => (value === "" ? undefined : value)),
  }),
  z.object({
    decision: z.literal("decline"),
    /*
     * The message is on the type as well as the length. Without it, a decline
     * posted with no note at all falls to zod's own wording, and the form
     * would show the pledger's treasurer "expected string, received
     * undefined" where a sentence should be.
     */
    note: z
      .string("Say why you are declining, so the pledger knows what to do next.")
      .trim()
      .min(
        MIN_DECISION_NOTE_LENGTH,
        "Say why you are declining, so the pledger knows what to do next.",
      )
      .max(MAX_REASON_LENGTH, "That note is longer than this accepts."),
  }),
]);

export type DecideChangeRequestInput = z.infer<typeof decideChangeRequestInput>;

/**
 * Whether a reduction is actually a reduction, and what to say when it is not.
 *
 * The rule cannot live in the schema, because it compares what was asked for
 * against what the pledge currently holds, and only the service has that. It
 * lives here rather than in the service so it can be tested as a value in and a
 * value out, and so the form in C3 can say the same sentence before anything is
 * submitted.
 *
 * An increase is refused rather than queued, and the message points at the
 * pledge form, because that path already exists and works: the form recognises
 * the phone number and adds to the pledge without anybody having to approve it.
 * Equal is refused too. A request to change a figure to the figure it already
 * is asks for nothing, and putting it in the queue spends a treasurer's
 * attention on a decision with no outcome.
 *
 * Returns null when the reduction stands, and the refusal otherwise.
 */
export function reduceAmountRefusal(
  requestedMinor: bigint,
  currentMinor: bigint,
): string | null {
  if (requestedMinor < currentMinor) return null;

  if (requestedMinor === currentMinor) {
    return "That is the amount your pledge is already for, so there is nothing to change.";
  }

  return "To increase a pledge, make another pledge with the same phone number and it will be added to this one. No approval is needed.";
}
