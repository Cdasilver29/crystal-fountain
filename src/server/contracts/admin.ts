import { z } from "zod";

/** Unlocks the admin screen with the shared secret. */
export const adminUnlockInput = z.object({
  secret: z.string().min(1, "Enter the admin secret."),
});

export type AdminUnlockInput = z.infer<typeof adminUnlockInput>;

/**
 * The only admin write in v1. Kept as an action rather than a raw status field
 * so an invalid transition is impossible to express, not merely rejected.
 */
export const adminPledgeActionInput = z.object({
  action: z.literal("approve", "That is not an action this screen can take."),
});

export type AdminPledgeActionInput = z.infer<typeof adminPledgeActionInput>;
