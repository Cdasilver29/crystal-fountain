import { and, eq, inArray, sql } from "drizzle-orm";

import type { Db } from "@/db";
import { adminUsers, auditLog } from "@/db/schema";

/**
 * Audit rows for the admin session lifecycle.
 *
 * CLAUDE.md: every admin write appends a row to audit_log, no exceptions.
 * Signing in and out are not writes to the pledge ledger, but they are the
 * events that explain who could have made one, so they belong here too.
 *
 * actor_type is constrained to public, admin, system or webhook. A failed or
 * locked out attempt is written as public on purpose: nobody has proved who
 * they are at that point, and recording an unproven identity as an admin would
 * make the trail say something it does not know.
 *
 * Plain functions taking a db handle, per the architecture rule. Nothing here
 * touches Request, cookies or next/headers.
 */

export type AuditContext = {
  ip: string | null;
  userAgent: string | null;
};

/** Resolves the admin_users row behind a Better Auth user id. */
export async function findAdminByAuthUserId(
  db: Db,
  authUserId: string,
): Promise<{ id: string; email: string; role: string } | null> {
  const [row] = await db
    .select({
      id: adminUsers.id,
      email: adminUsers.email,
      role: adminUsers.role,
    })
    .from(adminUsers)
    .where(eq(adminUsers.authUserId, authUserId))
    .limit(1);

  return row ?? null;
}

/** A completed sign in. Written when the session row itself is created. */
export async function recordLoginSuccess(
  db: Db,
  input: AuditContext & { adminUserId: string; email: string; role: string },
): Promise<void> {
  await db.insert(auditLog).values({
    actorType: "admin",
    actorId: input.adminUserId,
    action: "admin.login",
    entity: "admin_users",
    entityId: input.adminUserId,
    after: { email: input.email, role: input.role },
    ip: input.ip,
    userAgent: input.userAgent,
  });
}

/**
 * A rejected password. The attempted email is recorded deliberately: without
 * it the row cannot answer which account was being guessed at, which is the
 * only question anyone asks of these rows.
 */
export async function recordLoginFailed(
  db: Db,
  input: AuditContext & { email: string },
): Promise<void> {
  await db.insert(auditLog).values({
    actorType: "public",
    actorId: null,
    action: "admin.login_failed",
    entity: "admin_users",
    entityId: null,
    after: { email: input.email },
    ip: input.ip,
    userAgent: input.userAgent,
  });
}

/** An attempt refused because the account is inside its lockout window. */
export async function recordLoginLocked(
  db: Db,
  input: AuditContext & { email: string; retryAfterSeconds: number },
): Promise<void> {
  await db.insert(auditLog).values({
    actorType: "public",
    actorId: null,
    action: "admin.login_locked",
    entity: "admin_users",
    entityId: null,
    after: { email: input.email, retryAfterSeconds: input.retryAfterSeconds },
    ip: input.ip,
    userAgent: input.userAgent,
  });
}

/**
 * A Google account turned away at the callback.
 *
 * actor_type is public, the same as a rejected password. Google has vouched
 * that whoever this is controls that mailbox, which is more than a wrong
 * password proves, but it is still not evidence that they are an administrator
 * here, and that is the only identity this table is willing to write down as
 * admin.
 *
 * The attempted email is recorded deliberately, for the same reason it is on
 * admin.login_failed: without it the row cannot answer which address was
 * knocking, which is the only question anyone asks of these rows. The reason
 * separates a stranger from a retired administrator, a distinction the person
 * refused is deliberately not given.
 *
 * entity_id is the admin_users row when there is one, which is the retired
 * case, and null when the address has never been an administrator.
 */
export async function recordGoogleRejected(
  db: Db,
  input: AuditContext & {
    email: string;
    reason: "not_an_admin" | "deactivated";
    adminUserId: string | null;
  },
): Promise<void> {
  await db.insert(auditLog).values({
    actorType: "public",
    actorId: null,
    action: "admin.google_rejected",
    entity: "admin_users",
    entityId: input.adminUserId,
    after: { email: input.email, reason: input.reason },
    ip: input.ip,
    userAgent: input.userAgent,
  });
}

export async function recordLogout(
  db: Db,
  input: AuditContext & { adminUserId: string; email: string },
): Promise<void> {
  await db.insert(auditLog).values({
    actorType: "admin",
    actorId: input.adminUserId,
    action: "admin.logout",
    entity: "admin_users",
    entityId: input.adminUserId,
    after: { email: input.email },
    ip: input.ip,
    userAgent: input.userAgent,
  });
}

/**
 * TOTP enrolment completed.
 *
 * Guarded, because the hook this hangs off fires on any user update and
 * twoFactorEnabled stays true afterwards. Enrolment is a thing that happens
 * once, so the row is written once.
 */
export async function recordTotpEnrolled(
  db: Db,
  input: AuditContext & { adminUserId: string; email: string },
): Promise<void> {
  const [existing] = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, "admin.totp_enrolled"),
        eq(auditLog.actorId, input.adminUserId),
      ),
    )
    .limit(1);

  if (existing) return;

  await db.insert(auditLog).values({
    actorType: "admin",
    actorId: input.adminUserId,
    action: "admin.totp_enrolled",
    entity: "admin_users",
    entityId: input.adminUserId,
    after: { email: input.email },
    ip: input.ip,
    userAgent: input.userAgent,
  });
}

/**
 * A stale two factor flag put back down.
 *
 * Written as system rather than admin: nobody has proved who they are at the
 * point it happens and nobody asked for it. It is the login route noticing
 * that an account claims a second factor it no longer has an enrolment for,
 * which is what a lockout reset leaves behind, and repairing it so the next
 * sign in offers enrolment instead of a code field that can never pass.
 */
export async function recordTotpEnrolmentReset(
  db: Db,
  input: AuditContext & { email: string; authUserId: string },
): Promise<void> {
  const admin = await findAdminByAuthUserId(db, input.authUserId);

  await db.insert(auditLog).values({
    actorType: "system",
    actorId: null,
    action: "admin.totp_enrolment_reset",
    entity: "admin_users",
    entityId: admin?.id ?? null,
    after: { email: input.email, reason: "enrolment missing" },
    ip: input.ip,
    userAgent: input.userAgent,
  });
}

/**
 * An authenticated admin who tried something their role does not allow.
 *
 * Worth a row of its own. A viewer repeatedly reaching for the approve button
 * is either a misunderstanding to clear up or an account to look at, and
 * neither shows up anywhere else.
 */
export async function recordForbidden(
  db: Db,
  input: AuditContext & {
    adminUserId: string | null;
    role: string;
    attempted: string;
    entity: string;
    entityId: string | null;
  },
): Promise<void> {
  await db.insert(auditLog).values({
    actorType: "admin",
    actorId: input.adminUserId,
    action: "admin.forbidden",
    entity: input.entity,
    entityId: input.entityId,
    after: { role: input.role, attempted: input.attempted },
    ip: input.ip,
    userAgent: input.userAgent,
  });
}

/** Reads recent rows for a set of actions. Used by the verification script. */
export async function recentByAction(
  db: Db,
  actions: string[],
  limit = 20,
): Promise<
  { action: string; actorType: string; actorId: string | null; after: unknown }[]
> {
  return db
    .select({
      action: auditLog.action,
      actorType: auditLog.actorType,
      actorId: auditLog.actorId,
      after: auditLog.after,
    })
    .from(auditLog)
    /*
     * inArray rather than = any(). The driver sends a JavaScript array as a
     * single parameter, and postgres then tries to read the string
     * "admin.forbidden" as an array literal and fails. inArray builds a real
     * IN list, so one action works as well as five.
     */
    .where(inArray(auditLog.action, actions))
    .orderBy(sql`${auditLog.at} desc`)
    .limit(limit);
}
