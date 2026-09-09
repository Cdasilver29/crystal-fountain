import { z } from "zod";

/**
 * The only admin write in v1. Kept as an action rather than a raw status field
 * so an invalid transition is impossible to express, not merely rejected.
 */
export const adminPledgeActionInput = z.object({
  action: z.literal("approve", "That is not an action this screen can take."),
});

export type AdminPledgeActionInput = z.infer<typeof adminPledgeActionInput>;

/**
 * The treasurer looking for a pledge to match a payment against.
 *
 * A single free text box, because whoever is holding the receipt does not know
 * whether what they have is a reference, a phone number or a name. The service
 * decides which of the three it looks like.
 */
export const pledgeSearchQuery = z.object({
  q: z
    .string()
    .trim()
    .min(2, "Type at least two characters to search.")
    .max(64, "That search term is too long."),
});

export type PledgeSearchQuery = z.infer<typeof pledgeSearchQuery>;
