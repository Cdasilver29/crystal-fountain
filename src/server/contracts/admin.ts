import { z } from "zod";

/**
 * The only admin write in v1. Kept as an action rather than a raw status field
 * so an invalid transition is impossible to express, not merely rejected.
 */
export const adminPledgeActionInput = z.object({
  action: z.literal("approve", "That is not an action this screen can take."),
});

export type AdminPledgeActionInput = z.infer<typeof adminPledgeActionInput>;
