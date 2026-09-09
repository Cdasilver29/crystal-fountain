import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";

import { db } from "@/db";
import { adminUsers } from "@/db/schema";
import {
  ADMIN_COOKIE,
  adminSessionToken,
  safeEqual,
} from "@/lib/admin-session";
import { AUTH_SESSION_ABSOLUTE_MAX_AGE_SECONDS, getAuth } from "@/lib/auth";

/**
 * Who is signed in, across both auth paths.
 *
 * There are two ways to be an admin right now and every admin page and route
 * goes through this one function rather than picking a side. The Better Auth
 * path is the real one. The ADMIN_SECRET path is the shared secret that has
 * been holding the fort, and it keeps working until Part B removes it, because
 * the treasurer must not be locked out at any point in between.
 *
 * Better Auth wins when both are present, so an admin who has migrated gets
 * their real role and their real identity in the audit trail rather than the
 * synthetic one.
 */

export type AdminRole = "viewer" | "treasurer" | "admin";

export type CurrentAdmin = {
  /** The admin_users row id, or null for the legacy shared secret. */
  id: string | null;
  name: string;
  email: string | null;
  role: AdminRole;
  /** Which path authenticated this request. Written into audit rows. */
  source: "better-auth" | "legacy-secret";
  /** Whether TOTP is enrolled and verified. Always false on the legacy path. */
  twoFactorEnabled: boolean;
};

const ROLES: readonly AdminRole[] = ["viewer", "treasurer", "admin"];

function isRole(value: string): value is AdminRole {
  return (ROLES as readonly string[]).includes(value);
}

/**
 * The legacy shared secret holder.
 *
 * Full admin, because that is exactly what the secret granted before roles
 * existed. Narrowing it here would lock the treasurer out of work they can do
 * today, which is the one thing this change must not do.
 */
const LEGACY_ADMIN: CurrentAdmin = {
  id: null,
  name: "Legacy admin",
  email: null,
  role: "admin",
  source: "legacy-secret",
  twoFactorEnabled: false,
};

async function fromBetterAuth(): Promise<CurrentAdmin | null> {
  const session = await getAuth()
    .api.getSession({ headers: await headers() })
    .catch(() => null);

  if (!session) return null;

  /*
   * The absolute ceiling. expiresIn gives an eight hour idle window that rolls
   * forward every time the session is used, which on its own would let a
   * session live for as long as someone keeps clicking. Better Auth has no
   * absolute cap, so it is enforced here against the row's createdAt.
   */
  const ageSeconds =
    (Date.now() - new Date(session.session.createdAt).getTime()) / 1000;

  if (ageSeconds > AUTH_SESSION_ABSOLUTE_MAX_AGE_SECONDS) return null;

  // The role is ours, not Better Auth's. It lives on admin_users and is looked
  // up by the link column rather than trusted from the session.
  const [row] = await db
    .select({
      id: adminUsers.id,
      fullName: adminUsers.fullName,
      email: adminUsers.email,
      role: adminUsers.role,
      isActive: adminUsers.isActive,
    })
    .from(adminUsers)
    .where(eq(adminUsers.authUserId, session.user.id))
    .limit(1);

  // A Better Auth user with no admin_users row, or a deactivated one, is not
  // an admin. Failing closed here is deliberate.
  if (!row || !row.isActive || !isRole(row.role)) return null;

  return {
    id: row.id,
    name: row.fullName,
    email: row.email,
    role: row.role,
    source: "better-auth",
    twoFactorEnabled: session.user.twoFactorEnabled === true,
  };
}

async function fromLegacySecret(): Promise<CurrentAdmin | null> {
  const store = await cookies();
  const value = store.get(ADMIN_COOKIE)?.value;
  if (!value) return null;
  return safeEqual(value, adminSessionToken()) ? LEGACY_ADMIN : null;
}

/**
 * The current admin, or null. Used by every admin page and API route.
 */
export async function getCurrentAdmin(): Promise<CurrentAdmin | null> {
  return (await fromBetterAuth()) ?? (await fromLegacySecret());
}

/** Role ranking, so a check reads as "at least this much". */
const RANK: Record<AdminRole, number> = { viewer: 1, treasurer: 2, admin: 3 };

export function hasAtLeast(admin: CurrentAdmin, role: AdminRole): boolean {
  return RANK[admin.role] >= RANK[role];
}
