import { eq } from "drizzle-orm";
import { headers } from "next/headers";

import { db } from "@/db";
import { adminUsers } from "@/db/schema";
import { AUTH_SESSION_ABSOLUTE_MAX_AGE_SECONDS, getAuth } from "@/lib/auth";

/**
 * Who is signed in.
 *
 * One way in: a Better Auth session whose user has an active admin_users row.
 * The shared secret that used to stand beside this is gone, along with the
 * synthetic "Legacy admin" it resolved to, so every admin action now has a
 * real person's id on it in audit_log.
 *
 * Every admin page and API route goes through this function. The middleware
 * only checks that a cookie is present.
 */

export type AdminRole = "viewer" | "treasurer" | "admin";

export type CurrentAdmin = {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  /** Whether TOTP is enrolled and verified on this account. */
  twoFactorEnabled: boolean;
};

const ROLES: readonly AdminRole[] = ["viewer", "treasurer", "admin"];

function isRole(value: string): value is AdminRole {
  return (ROLES as readonly string[]).includes(value);
}

/**
 * The current admin, or null. Used by every admin page and API route.
 */
export async function getCurrentAdmin(): Promise<CurrentAdmin | null> {
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
    twoFactorEnabled: session.user.twoFactorEnabled === true,
  };
}

/** Role ranking, so a check reads as "at least this much". */
const RANK: Record<AdminRole, number> = { viewer: 1, treasurer: 2, admin: 3 };

export function hasAtLeast(admin: CurrentAdmin, role: AdminRole): boolean {
  return RANK[admin.role] >= RANK[role];
}
