import { and, eq, isNull } from "drizzle-orm";

import type { Db } from "@/db";
import { adminUsers, authUsers } from "@/db/schema";
import { ServiceError } from "@/server/errors";

/**
 * Who is allowed in through Google.
 *
 * Google sign in is not sign up. Anybody on earth can present a Google account
 * that Google is perfectly happy to vouch for, so the question this file
 * answers is not "is this a real person" but "is this address already an
 * administrator here". There is no separate allowlist table: a super
 * administrator creating somebody at /admin/users is what authorises that
 * address, and retiring them is what withdraws it.
 *
 * Plain functions taking a db handle, per the architecture rule in CLAUDE.md.
 * Nothing here touches Request, Response, cookies or next/headers, and nothing
 * here knows that Better Auth exists. The hooks in src/lib/auth.ts are the
 * adapter that calls this.
 *
 * Keeping the decision here rather than inline in the hook is deliberate: a
 * gate that can only be exercised by completing a real OAuth round trip is a
 * gate nobody tests. This one is a function taking an email, so the
 * verification script drives every branch of it against real rows.
 */

/** The code that travels back to the sign in page in the error query string. */
export const GOOGLE_REJECTED_CODE = "google_not_authorised";

/**
 * What the person is told.
 *
 * Deliberately the same sentence for "never was an administrator" and "was one
 * and is retired". Telling an outsider which addresses are administrators here
 * would answer a question they have no business asking, and the reason is on
 * the audit row for whoever does have business asking it.
 */
export const GOOGLE_REJECTED_MESSAGE =
  "This Google account is not authorised for the admin portal. Contact the administrator.";

export type GoogleKeys = {
  clientId: string | undefined;
  clientSecret: string | undefined;
};

/**
 * Whether Google sign in is switched on.
 *
 * Modelled on isTurnstileConfigured, and for the same reason: a half
 * configured pair is neither state and guessing at it is worse than stopping.
 * A client id with no secret cannot complete a sign in, and treating it as
 * "configured" would render a button that always fails, while treating it as
 * "not configured" would quietly ignore a variable somebody meant to set.
 */
export function isGoogleConfigured(keys: GoogleKeys): boolean {
  const id = keys.clientId?.trim() ?? "";
  const secret = keys.clientSecret?.trim() ?? "";

  if (id !== "" && secret !== "") return true;
  if (id === "" && secret === "") return false;

  throw new ServiceError(
    "google_misconfigured",
    "Google sign in is half configured. Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither.",
    500,
  );
}

export type GoogleGateResult =
  | { allowed: true; adminUserId: string; email: string; role: string }
  | {
      allowed: false;
      /*
       * Never shown to the person refused. It is for the audit row, so that
       * somebody reading the trail can tell a stranger trying their luck from
       * a retired treasurer who did not realise they had been retired.
       */
      reason: "not_an_admin" | "deactivated";
      adminUserId: string | null;
      email: string;
    };

/**
 * The gate itself.
 *
 * Matched on email, case insensitively, which admin_users.email already is:
 * the column is citext, so "Treasurer@example.org" from Google finds the row
 * stored as "treasurer@example.org" without either side normalising first.
 *
 * is_active is read here rather than left to getCurrentAdmin. That function
 * already fails closed on a retired account, so a deactivated person could
 * never use the portal, but without this check they would still collect a
 * session cookie and a sign in that looked like it worked. The same reasoning
 * as the deactivated branch of /api/admin/login.
 */
export async function checkGoogleSignIn(
  db: Db,
  input: { email: string },
): Promise<GoogleGateResult> {
  const email = input.email.trim();

  if (email === "") {
    return { allowed: false, reason: "not_an_admin", adminUserId: null, email };
  }

  const [row] = await db
    .select({
      id: adminUsers.id,
      email: adminUsers.email,
      role: adminUsers.role,
      isActive: adminUsers.isActive,
    })
    .from(adminUsers)
    .where(eq(adminUsers.email, email))
    .limit(1);

  if (!row) {
    return { allowed: false, reason: "not_an_admin", adminUserId: null, email };
  }

  if (!row.isActive) {
    return { allowed: false, reason: "deactivated", adminUserId: row.id, email };
  }

  return {
    allowed: true,
    adminUserId: row.id,
    email: row.email,
    role: row.role,
  };
}

/**
 * The address behind a Better Auth user id.
 *
 * Needed because the session hook is handed a user id and nothing else, and
 * the gate asks its question in terms of an email address. Safe to read from
 * our own handle: Better Auth commits the user before it creates the session,
 * so by the time the session hook runs this row is visible outside the
 * library's transaction.
 */
export async function emailForAuthUser(
  db: Db,
  authUserId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ email: authUsers.email })
    .from(authUsers)
    .where(eq(authUsers.id, authUserId))
    .limit(1);

  return row?.email ?? null;
}

/**
 * Points an admin_users row at the Better Auth user Google just created.
 *
 * Only ever fills a hole. Every account made through /admin/users or
 * /admin/setup already has its credential and its link, so this does nothing
 * in the ordinary case. It exists because an authorised row whose
 * auth_user_id is null would otherwise sign in through Google perfectly
 * happily and then be refused by getCurrentAdmin on every page, which looks
 * like a broken portal rather than a missing link.
 *
 * Never overwrites an existing link. The where clause is the guard.
 */
export async function linkAuthUser(
  db: Db,
  input: { adminUserId: string; authUserId: string },
): Promise<void> {
  await db
    .update(adminUsers)
    .set({ authUserId: input.authUserId })
    .where(
      and(eq(adminUsers.id, input.adminUserId), isNull(adminUsers.authUserId)),
    );
}
