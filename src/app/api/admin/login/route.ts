import { db } from "@/db";
import { clientIp, problem, userAgent, validationProblem } from "@/lib/api";
import { getAuth } from "@/lib/auth";
import { adminLoginInput } from "@/server/contracts/auth";
import * as audit from "@/server/services/admin-audit";
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

  // Forwarded whole. The body carries twoFactorRedirect when the account has
  // TOTP enrolled, which is how the form knows to show the code step.
  return response;
}
