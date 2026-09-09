import { sql } from "drizzle-orm";

import type { Db } from "@/db";

/**
 * A throwaway administrator for the verification scripts.
 *
 * These scripts used to provision the very first administrator through
 * /api/admin/setup, which worked only while admin_users was empty. Once a real
 * administrator exists that endpoint is closed for good, and rightly so, which
 * left the scripts unable to sign in at all.
 *
 * So the account is provisioned the same way the setup service does it, using
 * Better Auth's own context to hash the password and create the credential,
 * but without the "must be the first" gate. It is a real, ordinary admin
 * account for as long as the script runs, and it is deleted at the end.
 *
 * Never touches an account that already exists. Every script sweeps only rows
 * whose email matches the verification pattern.
 */

export const VERIFICATION_EMAIL_PATTERN = "verify-part-%@example.test";

export type ProvisionedAdmin = {
  adminUserId: string;
  authUserId: string;
};

export async function provisionAdmin(
  db: Db,
  input: { email: string; password: string; fullName: string; role: string },
): Promise<ProvisionedAdmin> {
  const { getAuth } = await import("@/lib/auth");
  const ctx = await getAuth().$context;

  // Scrypt is deliberately slow, so it runs before anything is written.
  const passwordHash = await ctx.password.hash(input.password);

  const user = await ctx.internalAdapter.createUser(
    { name: input.fullName, email: input.email, emailVerified: false },
    { method: "email-password" },
  );

  await ctx.internalAdapter.createAccount({
    userId: user.id,
    // Better Auth looks the credential up by this provider id.
    providerId: "credential",
    accountId: user.id,
    password: passwordHash,
  });

  const inserted = await db.execute(sql`
    insert into admin_users (email, full_name, role, auth_user_id)
    values (${input.email}, ${input.fullName}, ${input.role}, ${user.id})
    returning id
  `);

  return {
    adminUserId: String((inserted.rows as { id: string }[])[0].id),
    authUserId: user.id,
  };
}

/**
 * Removes every verification account, and only those.
 *
 * admin_users references auth_users, so the admin row goes first. The pattern
 * is the guard: a real administrator's address never matches it.
 */
export async function removeVerificationAdmins(db: Db): Promise<void> {
  await db.execute(sql`
    delete from admin_users where email like ${VERIFICATION_EMAIL_PATTERN}
  `);
  await db.execute(sql`
    delete from auth_users where email like ${VERIFICATION_EMAIL_PATTERN}
  `);
  await db.execute(sql`
    delete from admin_login_attempts where email like ${VERIFICATION_EMAIL_PATTERN}
  `);
}
