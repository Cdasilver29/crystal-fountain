import { z } from "zod";

/**
 * The settings the super administrator can change.
 *
 * Every field is optional: the screen sends only what moved, and a save that
 * changes nothing writes nothing rather than an audit row saying a value was
 * set to what it already was.
 *
 * Money arrives as whole shillings and is converted in the service, the same
 * way every other amount in this system does.
 */

/** An empty box means "leave this unset", not "set this to an empty string". */
const optionalText = (max: number) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? null : value,
    z.string().trim().max(max).nullable().optional(),
  );

export const campaignSettingsInput = z.object({
  /*
   * The figure the whole campaign is measured against. Raising it makes every
   * percentage on the site smaller overnight, which is a thing a congregation
   * notices, so it is audited like money.
   */
  targetKes: z
    .number("Enter the target in shillings.")
    .int("Enter a whole number of shillings.")
    .positive("The target has to be more than nothing.")
    .max(1_000_000_000_000, "That target is implausibly large.")
    .optional(),

  /*
   * Money raised before this platform existed. It is added to both the pledged
   * and the received figures, so it moves two public numbers at once.
   */
  openingBalanceKes: z
    .number("Enter the opening balance in shillings.")
    .int("Enter a whole number of shillings.")
    .min(0, "An opening balance cannot be less than nothing.")
    .max(1_000_000_000_000, "That opening balance is implausibly large.")
    .optional(),

  /*
   * Null puts it back to the environment default. Zero is refused by the
   * database: holding every pledge for review is a reasonable thing to want,
   * but not a thing to arrive at by leaving a box empty.
   */
  autoApproveLimitKes: z
    .number()
    .int("Enter a whole number of shillings.")
    .positive("Use a limit above zero, or clear it to use the default.")
    .nullable()
    .optional(),

  isPublic: z.boolean().optional(),

  mpesaPaybill: optionalText(32),
  mpesaAccountName: optionalText(160),
  bankName: optionalText(160),
  bankBranch: optionalText(160),
  bankAccountName: optionalText(160),
  bankAccount: optionalText(64),
  bankSwift: optionalText(32),
  bankBranchCode: optionalText(32),
});

export type CampaignSettingsInput = z.infer<typeof campaignSettingsInput>;

/** The fields that decide where money is sent, named once. */
export const PAYMENT_DETAIL_FIELDS = [
  "mpesaPaybill",
  "mpesaAccountName",
  "bankName",
  "bankBranch",
  "bankAccountName",
  "bankAccount",
  "bankSwift",
  "bankBranchCode",
] as const;

export type PaymentDetailField = (typeof PAYMENT_DETAIL_FIELDS)[number];
