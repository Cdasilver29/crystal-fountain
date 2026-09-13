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

/**
 * The codes that travel back to the sign in page in the error query string.
 *
 * They are the reasons, so the two refusals can be told apart on the way back
 * and given different sentences.
 *
 * G1 used one code for both on the grounds that naming which addresses are
 * administrators answers a question an outsider has no business asking. That
 * was too cautious. Neither message can be read without first completing a
 * real Google sign in as that address, so the only account anybody can learn
 * anything about is one they already control, and there is no way to probe an
 * address belonging to somebody else. /api/admin/login already draws exactly
 * this line: it says nothing about whether an account exists until a correct
 * password has been presented, then names the deactivation plainly.
 *
 * The wording still never says "you are an administrator here". A retired
 * administrator is told their account is deactivated, which is about them, not
 * about the shape of the portal.
 */
export const GOOGLE_REJECTED_CODES = {
  not_an_admin: "not_an_admin",
  deactivated: "deactivated",
} as const;

/** What each refusal says on the sign in page. */
export const GOOGLE_REJECTED_MESSAGES: Record<string, string> = {
  not_an_admin:
    "This Google account is not authorised for the admin portal. Contact the administrator.",
  deactivated:
    "This account has been deactivated. Contact the administrator.",
};

/**
 * What a code that is not one of ours says.
 *
 * Everything else that can come back on that query string is Better Auth's or
 * Google's, in their words, about their internals. Anything from a cancelled
 * consent screen to a mismatched redirect URI lands here, and none of it is
 * worth showing to a treasurer.
 */
export const GOOGLE_FAILED_MESSAGE =
  "Sign-in failed. Try again or use your email and password.";

/**
 * The sentence for an error code coming back from the callback.
 *
 * Mapped, never printed. error_description on that query string is chosen by
 * whoever wrote the link, so rendering it would let anyone who can get an
 * administrator to click something put their own words inside the portal's own
 * error box, next to its own branding. An unrecognised code gets the generic
 * sentence instead.
 */
export function messageForRejection(code: string | undefined): string {
  if (!code) return GOOGLE_FAILED_MESSAGE;
  return GOOGLE_REJECTED_MESSAGES[code] ?? GOOGLE_FAILED_MESSAGE;
}

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
