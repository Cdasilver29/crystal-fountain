import { z } from "zod";

/**
 * Managing the people who can sign in to the portal.
 *
 * Shared by the screens and the route handlers, like every other contract here.
 * Client validation is convenience; these same schemas run server side on every
 * request.
 */

export const ADMIN_ROLES = ["viewer", "treasurer", "admin"] as const;
export type AdminUserRole = (typeof ADMIN_ROLES)[number];

/**
 * How many people may hold an account at once.
 *
 * Counted over active accounts only. Deactivating is how an account is retired,
 * and if a retired one still held its place the cap would be a trap: five
 * departures and nobody could ever be added again.
 */
export const MAX_ADMIN_USERS = 5;

/** Length of a generated temporary password. */
export const TEMPORARY_PASSWORD_LENGTH = 16;

/** What Better Auth requires, so the two cannot disagree about a short one. */
export const MIN_PASSWORD_LENGTH = 12;

export const createAdminUserInput = z.object({
  fullName: z.string().trim().min(2, "Enter their full name."),
  email: z.email("Enter a valid email address.").trim(),
  role: z.enum(ADMIN_ROLES, "Choose a role."),
});

export type CreateAdminUserInput = z.infer<typeof createAdminUserInput>;

/**
 * Editing an existing account.
 *
 * The email address is absent on purpose. It is the identity key: it is what
 * Better Auth signs somebody in by, what the login lockout counts against, and
 * what every audit row about this person is findable by. Changing it would
 * quietly detach all three.
 */
export const updateAdminUserInput = z.object({
  fullName: z.string().trim().min(2, "Enter their full name.").optional(),
  role: z.enum(ADMIN_ROLES).optional(),
});

export type UpdateAdminUserInput = z.infer<typeof updateAdminUserInput>;

export const adminUserPathParams = z.object({
  adminUserId: z.uuid("That is not an administrator."),
});

/**
 * Somebody setting their own password.
 *
 * The current one is required even when a forced change is what brought them
 * here. A temporary password is known to whoever generated it, and asking for
 * it proves the person at the keyboard is the one it was handed to rather than
 * somebody who found an open session.
 */
export const changeOwnPasswordInput = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
      .max(200, "That password is too long."),
    confirmPassword: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Both passwords must match.",
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    path: ["newPassword"],
    message: "Choose a password you have not just been using.",
  });

export type ChangeOwnPasswordInput = z.infer<typeof changeOwnPasswordInput>;

/**
 * A temporary password, generated rather than chosen.
 *
 * Sixteen characters from a 58 character alphabet is roughly 93 bits, which is
 * far past anything that has to survive being read aloud once and typed in.
 * Ambiguous glyphs are left out: this gets dictated across a room or copied off
 * a screen, and an O that was really a 0 is a support call.
 */
const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateTemporaryPassword(
  randomBytes: (n: number) => Uint8Array,
): string {
  /*
   * Rejection sampling, so every character is equally likely. Taking a byte
   * modulo 58 would make the first few letters of the alphabet slightly more
   * common, which is a small bias but a pointless one to accept.
   */
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  let out = "";

  while (out.length < TEMPORARY_PASSWORD_LENGTH) {
    for (const byte of randomBytes(TEMPORARY_PASSWORD_LENGTH)) {
      if (byte >= limit) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === TEMPORARY_PASSWORD_LENGTH) break;
    }
  }

  return out;
}
