import { eq } from "drizzle-orm";

import { db } from "@/db";
import { adminUsers, authSessions } from "@/db/schema";
import { clientIp, problem, userAgent, validationProblem } from "@/lib/api";
import { getAuth } from "@/lib/auth";
import { adminLoginInput } from "@/server/contracts/auth";
import * as audit from "@/server/services/admin-audit";
import * as twoFactor from "@/server/services/admin-two-factor";
import * as attempts from "@/server/services/login-attempts";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/login
 *
 * The password stage of admin login.
 *
 * Better Auth's sign in endpoint is wrapped rather than called directly from
 * the browser, because the per email lockout has to sit either side of it:
 * refuse before the password is checked, record after it is rejected, clear
 * once it is accepted. Better Auth's own limiter keys on ip and path and
 * counts every request rather than every failure, so it cannot do this.
 *
 * The response from Better Auth is forwarded whole, cookies included, so the
 * session cookie it sets survives the wrapping.
 *
 * The success row is not written here. A session is only created once the
 * second factor has also passed, so admin.login hangs off the session row
 * itself in lib/auth.ts, where both flows converge. Only the two failure
 * cases, which never reach a session, are recorded from this route.
 */
export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return problem(400, "invalid_json", "That request body was not valid JSON.");
  }

  const parsed = adminLoginInput.safeParse(body);

  if (!parsed.success) {
    return validationProblem(parsed.error);
  }

  const { email, password } = parsed.data;
  const ip = clientIp(request);
  const agent = userAgent(request);

  const lockout = await attempts.getLockoutState(db, { email });

  if (lockout.locked) {
    await audit.recordLoginLocked(db, {
      email,
      retryAfterSeconds: lockout.retryAfterSeconds,
      ip,
      userAgent: agent,
    });

    const minutes = Math.max(1, Math.ceil(lockout.retryAfterSeconds / 60));
    return problem(
      429,
      "locked_out",
      `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      { detail: String(lockout.retryAfterSeconds) },
    );
  }

  /*
   * An account whose enrolment row was deleted, by a lockout reset or any
   * other hand edit, still carries two_factor_enabled. Left alone, Better Auth
   * branches on that flag below, answers twoFactorRedirect, throws the session
   * away and sends the person to a code field checked against a secret that is
   * gone: "TOTP not enabled" on every attempt, with no way to enrol again.
   *
   * The flag is put back down first, so the sign in below takes the ordinary
   * no second factor path and the form shows the enrolment QR exactly as it
   * does for a first login. It has to happen before the sign in rather than
   * after, because afterwards the session the enrolment needs is already gone.
   *
   * Nothing is repaired for an account that still has its enrolment row, and
   * the flag on its own opens nothing, so this is not a way past the second
   * factor for anybody who has the password.
   */
  const repair = await twoFactor.clearStaleTotpFlag(db, { email });

  if (repair.cleared && repair.authUserId) {
    await audit.recordTotpEnrolmentReset(db, {
      email,
      authUserId: repair.authUserId,
      ip,
      userAgent: agent,
    });
  }

  const response = await getAuth()
    .api.signInEmail({
      body: { email, password },
      headers: request.headers,
      asResponse: true,
    })
    .catch(() => null);

  if (!response || !response.ok) {
    await attempts.recordFailure(db, { email, ip, userAgent: agent });
    await audit.recordLoginFailed(db, { email, ip, userAgent: agent });

    const remaining = Math.max(0, attempts.MAX_FAILURES - (lockout.failures + 1));

    // Deliberately says nothing about which half was wrong, and nothing about
    // whether the account exists.
    return problem(401, "invalid_credentials", "That email and password do not match.", {
      detail: String(remaining),
    });
  }

  await attempts.clearFailures(db, { email });

  /*
   * A retired account is refused here, at the door.
   *
   * getCurrentAdmin already fails closed on is_active, so a deactivated person
   * could never actually use the portal, but without this they still got a
   * session cookie and a login that looked like it worked. Deactivating
   * somebody should stop them at the point they try, not leave them wandering
   * a portal that silently refuses every screen.
   *
   * Checked after the password rather than before it on purpose. Refusing
   * before would answer "is this address a deactivated administrator" to
   * anybody who typed one, and the specific message below is only shown to
   * somebody who has already proved they know the password.
   */
  const [row] = await db
    .select({ isActive: adminUsers.isActive, authUserId: adminUsers.authUserId })
    .from(adminUsers)
    .where(eq(adminUsers.email, email))
    .limit(1);

  if (row && !row.isActive) {
    // Better Auth may already have opened a session. The cookie is in the
    // response being discarded and never reaches the browser, but the row
    // would outlive this request, so it goes too.
    if (row.authUserId) {
      await db
        .delete(authSessions)
        .where(eq(authSessions.userId, row.authUserId));
    }

    await audit.recordLoginFailed(db, { email, ip, userAgent: agent });

    return problem(
      403,
      "account_deactivated",
      "That account has been deactivated. Ask an administrator to restore it.",
    );
  }

  // Forwarded whole. The body carries twoFactorRedirect when the account has
  // TOTP enrolled, and twoFactorMethods listing what it can be asked for,
  // which together are how the form knows to show the code step.
  return response;
}
