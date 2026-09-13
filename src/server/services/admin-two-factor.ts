import { eq } from "drizzle-orm";

import type { Db } from "@/db";
import { authTwoFactors, authUsers } from "@/db/schema";

/**
 * The state of an account's second factor, and the repair for one half of it.
 *
 * Two rows have to agree for TOTP to work: auth_users.two_factor_enabled says
 * the account has a second factor, and a row in auth_two_factors holds the
 * secret it is checked against. Better Auth writes both in the same request
 * and never lets them drift on its own, but the enrolment row is also what a
 * lockout reset deletes by hand, and deleting it leaves the flag behind.
 *
 * That combination is a dead end. Sign in sees the flag, answers
 * twoFactorRedirect and throws the session away, and the code the form then
 * asks for is checked against a secret that no longer exists, so every attempt
 * comes back "TOTP not enabled" and enrolment is never offered. The account is
 * locked out of a portal it has the password for.
 *
 * The flag is the half that is wrong: an account with no secret does not have
 * a second factor. Clearing it puts the account back where a brand new one
 * starts, which is the state the login form already knows how to handle.
 *
 * Plain functions taking a db handle, per the architecture rule. Nothing here
 * touches Request, cookies or next/headers.
 */

export type TotpFlagRepair = {
  /** True when the stale flag was found and cleared by this call. */
  cleared: boolean;
  /** The Better Auth user, when the email matched one. */
  authUserId: string | null;
};

/**
 * Clears two_factor_enabled when the account has no enrolment to check against.
 *
 * An enrolment counts only when Better Auth would accept it. A row with
 * verified false is one the plugin itself refuses at sign in, so it is treated
 * the same as no row at all; enrolment overwrites it in place afterwards.
 *
 * Idempotent. Once the flag is down the condition no longer matches, so a
 * second call does nothing and reports false.
 *
 * Deliberately runs before the password is checked. The flag on its own grants
 * nothing: it only decides which screen the form shows next, and an account
 * whose enrolment row exists is never touched here, so there is nothing to
 * gain by asking for this repair without the password. Running it afterwards
 * would be too late, because by then Better Auth has already branched on the
 * flag, discarded the session and left the browser with nothing to enrol with.
 */
export async function clearStaleTotpFlag(
  db: Db,
  input: { email: string },
): Promise<TotpFlagRepair> {
  const [user] = await db
    .select({ id: authUsers.id, enabled: authUsers.twoFactorEnabled })
    .from(authUsers)
    .where(eq(authUsers.email, input.email))
    .limit(1);

  if (!user) return { cleared: false, authUserId: null };
  if (user.enabled !== true) return { cleared: false, authUserId: user.id };

  const [enrolment] = await db
    .select({ verified: authTwoFactors.verified })
    .from(authTwoFactors)
    .where(eq(authTwoFactors.userId, user.id))
    .limit(1);

  if (enrolment && enrolment.verified !== false) {
    return { cleared: false, authUserId: user.id };
  }

  await db
    .update(authUsers)
    .set({ twoFactorEnabled: false, updatedAt: new Date() })
    .where(eq(authUsers.id, user.id));

  return { cleared: true, authUserId: user.id };
}
