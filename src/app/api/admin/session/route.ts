import { cookies } from "next/headers";

import { problem, validationProblem } from "@/lib/api";
import {
  ADMIN_COOKIE,
  adminCookieOptions,
  adminSessionToken,
  isValidSecret,
} from "@/lib/admin-session";
import { adminUnlockInput } from "@/server/contracts/admin";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/session
 *
 * Exchanges the shared secret for a session cookie. Placeholder auth until
 * real per-user admin auth with TOTP lands against admin_users.
 */
export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return problem(400, "invalid_json", "That request body was not valid JSON.");
  }

  const parsed = adminUnlockInput.safeParse(body);

  if (!parsed.success) {
    return validationProblem(parsed.error);
  }

  if (!isValidSecret(parsed.data.secret)) {
    // Deliberately says nothing about which part was wrong.
    return problem(401, "unauthorized", "That secret is not right.");
  }

  const store = await cookies();
  store.set(ADMIN_COOKIE, adminSessionToken(), adminCookieOptions());

  return Response.json({ ok: true });
}

/** Signs out. */
export async function DELETE() {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
  return Response.json({ ok: true });
}
