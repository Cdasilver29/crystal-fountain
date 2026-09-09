import { z } from "zod";

/** The password stage of admin login. */
export const adminLoginInput = z.object({
  email: z.email("Enter the email address you sign in with.").trim(),
  password: z.string().min(1, "Enter your password."),
});

export type AdminLoginInput = z.infer<typeof adminLoginInput>;

/**
 * The first admin account.
 *
 * Twelve characters minimum, matching the Better Auth config. The confirmation
 * field is compared here rather than in the browser, so a mismatch cannot be
 * skipped by posting straight at the endpoint.
 */
export const adminSetupInput = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, "Enter the full name of this administrator.")
      .max(120, "That name is too long."),
    email: z.email("Enter a valid email address.").trim(),
    password: z
      .string()
      .min(12, "Use at least 12 characters.")
      .max(200, "That password is too long."),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Both passwords must match.",
  });

export type AdminSetupInput = z.infer<typeof adminSetupInput>;
