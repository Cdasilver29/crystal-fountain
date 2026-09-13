import { and, count, eq, ne, sql } from "drizzle-orm";

import type { Db } from "@/db";
import { adminUsers, auditLog, authAccounts, authSessions } from "@/db/schema";
import { conflict, notFound, rejected } from "@/server/errors";
import {
  MAX_ADMIN_USERS,
  type AdminUserRole,
  type CreateAdminUserInput,
  type UpdateAdminUserInput,
} from "@/server/contracts/admin-users";

/**
 * The people who can sign in to the portal.
 *
 * Plain functions taking (db, input), per CLAUDE.md. Nothing here reads
 * cookies, touches Request or Response, or knows which route called it.
 *
 * Creating and deleting an account spans two systems: Better Auth owns the
 * credential, admin_users owns the role. They cannot share one transaction,
 * because Better Auth's adapter holds its own handle, so the same shape as
 * admin-setup is used: the credential is made first and undone again if the
 * admin_users write fails, leaving neither behind.
 */

export type AuthAccountWriter = {
  hashPassword(password: string): Promise<string>;
  createUser(input: { name: string; email: string }): Promise<{ id: string }>;
  createCredentialAccount(input: {
    userId: string;
    passwordHash: string;
  }): Promise<void>;
  /** Compensating action, used only when the admin_users write fails. */
  deleteUser(userId: string): Promise<void>;
  /** Whether this password is the one on the account. */
  verifyPassword(input: {
    userId: string;
    password: string;
  }): Promise<boolean>;
};

export type AuditContext = {
  ip?: string | null;
  userAgent?: string | null;
};

export type AdminUserRow = {
  id: string;
  fullName: string;
  email: string;
  role: AdminUserRole;
  isActive: boolean;
  isSuper: boolean;
  twoFactorEnabled: boolean;
  /** A credential account with a hash on it. */
  hasPassword: boolean;
  /** A linked Google account. */
  hasGoogle: boolean;
  /**
   * One way in and no second factor to fall back on.
   *
   * Worth surfacing because it is the shape that ends with somebody locked
   * out of the pledge ledger: lose the one thing and there is no other door
   * and no backup code. An account with two methods survives losing one, and
   * an account with TOTP has backup codes.
   */
  singleMethod: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
};

type ListRow = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
  is_super: boolean;
  has_totp: boolean;
  has_password: boolean;
  has_google: boolean;
  force_password_change: boolean;
  last_login_at: string | null;
  created_at: string;
};

/**
 * Everyone with an account, retired ones last.
 *
 * TOTP enrolment is read from the enrolment Better Auth actually checks a code
 * against: a row in auth_two_factors, reached through auth_user_id. Never the
 * secret itself, which does not leave the database.
 *
 * Not admin_users.totp_secret, which this used to read. That column predated
 * the two factor plugin and meant something different from the plugin's own
 * secret, so nothing had written it since Better Auth arrived: every account
 * enrolled through the login screen showed as not enrolled, and an account
 * whose enrolment was deleted by a lockout reset would have gone on showing as
 * enrolled. Migration 0011 dropped it.
 *
 * auth_users.two_factor_enabled is deliberately not the source either. It is
 * the flag, not the enrolment, and the two can drift: it is what a lockout
 * reset leaves behind, and what the login route puts back down. A row with
 * verified false is one Better Auth itself refuses at sign in, so it does not
 * count as enrolled here.
 */
/** How many ways into the portal an account actually has. */
export function countSignInMethods(account: {
  has_password: boolean;
  has_google: boolean;
}): number {
  return (account.has_password ? 1 : 0) + (account.has_google ? 1 : 0);
}

/**
 * One door and no spare key.
 *
 * Two methods is not single, whatever the second factor situation, because
 * losing one still leaves the other. One method with TOTP is not single
 * either: enrolment hands out backup codes, which are the spare key.
 *
 * One method and no enrolment is the shape worth warning about. Lose the
 * password, or lose the Google account, and there is no other way in and
 * nothing to fall back on.
 *
 * An account with no method at all counts as single. It is already worse than
 * the warning describes, and it is what a row created before its credential
 * exists looks like.
 */
export function isSingleMethod(account: {
  has_password: boolean;
  has_google: boolean;
  has_totp: boolean;
}): boolean {
  if (countSignInMethods(account) >= 2) return false;
  return !account.has_totp;
}

/**
 * Whether a sign in method may be taken away from this account.
 *
 * Nothing in the portal removes a method today, so this guards no button yet.
 * It is the rule itself, in the one place the rule belongs, so that the day an
 * unlink action is built it cannot be built without it, and so that the
 * verification suite can hold it to account now rather than then.
 *
 * The last method is refused for everybody, not only the super
 * administrator. An ordinary administrator left with no way in is a person who
 * cannot work and a row somebody has to repair; the super administrator is
 * worse only because nobody can repair it for them.
 */
export function canRemoveSignInMethod(account: {
  has_password: boolean;
  has_google: boolean;
}): boolean {
  return countSignInMethods(account) > 1;
}

/**
 * Which credentials one account can sign in with.
 *
 * The same two questions list() asks for every row, asked for one, so the
 * guard and the badge cannot drift apart into two different ideas of what a
 * password is.
 */
export async function signInMethods(
  db: Db,
  adminUserId: string,
): Promise<{ has_password: boolean; has_google: boolean; has_totp: boolean }> {
  const result = await db.execute(sql`
    select exists (
             select 1 from auth_accounts c
             where c.user_id = a.auth_user_id
               and c.provider_id = 'credential'
               and c.password is not null
           ) as has_password,
           exists (
             select 1 from auth_accounts g
             where g.user_id = a.auth_user_id
               and g.provider_id = 'google'
           ) as has_google,
           exists (
             select 1 from auth_two_factors t
             where t.user_id = a.auth_user_id
               and t.verified is distinct from false
           ) as has_totp
    from admin_users a
    where a.id = ${adminUserId}::uuid
  `);

  const row = (result.rows as Record<string, boolean>[])[0];

  return {
    has_password: row?.has_password ?? false,
    has_google: row?.has_google ?? false,
    has_totp: row?.has_totp ?? false,
  };
}

export async function list(db: Db): Promise<AdminUserRow[]> {
  const result = await db.execute(sql`
    select a.id,
           a.full_name,
           a.email,
           a.role,
           a.is_active,
           a.is_super,
           exists (
             select 1
             from auth_two_factors t
             where t.user_id = a.auth_user_id
               and t.verified is distinct from false
           ) as has_totp,
           /*
            * Which credentials this account can actually sign in with, read
            * from auth_accounts rather than inferred.
            *
            * A password is a credential row with a hash on it. The row can
            * exist with a null password, which is what a Google only account
            * looks like from this side, and treating that as a password would
            * put a badge on an account that cannot use one.
            */
           exists (
             select 1
             from auth_accounts c
             where c.user_id = a.auth_user_id
               and c.provider_id = 'credential'
               and c.password is not null
           ) as has_password,
           exists (
             select 1
             from auth_accounts g
             where g.user_id = a.auth_user_id
               and g.provider_id = 'google'
           ) as has_google,
           a.force_password_change,
           a.last_login_at,
           a.created_at
    from admin_users a
    order by a.is_active desc, a.is_super desc, a.created_at
  `);

  return (result.rows as ListRow[]).map((row) => ({
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    role: row.role as AdminUserRole,
    isActive: row.is_active,
    isSuper: row.is_super,
    twoFactorEnabled: row.has_totp,
    hasPassword: row.has_password,
    hasGoogle: row.has_google,
    singleMethod: isSingleMethod(row),
    mustChangePassword: row.force_password_change,
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at) : null,
    createdAt: new Date(row.created_at),
  }));
}

/** How many accounts are in use, and whether another will fit. */
export async function capacity(
  db: Db,
): Promise<{ active: number; limit: number; full: boolean }> {
  const [row] = await db
    .select({ n: count() })
    .from(adminUsers)
    .where(eq(adminUsers.isActive, true));

  const active = row?.n ?? 0;

  return { active, limit: MAX_ADMIN_USERS, full: active >= MAX_ADMIN_USERS };
}

export type CreateArgs = {
  input: CreateAdminUserInput;
  /** Already generated by the caller, so this stays free of randomness. */
  temporaryPassword: string;
  actorId: string;
  request?: AuditContext;
};

export type CreateResult = { adminUserId: string };

/**
 * Adds somebody to the portal.
 *
 * They arrive with a temporary password and force_password_change set, so the
 * first thing the account can do is stop being reachable by whoever created it.
 *
 * Whether the caller may create this particular role is decided above, in the
 * rights table: creating an administrator is the super administrator's alone.
 * This function enforces the things that are true regardless of who is asking,
 * which are the cap and the uniqueness of the address.
 */
export async function create(
  db: Db,
  auth: AuthAccountWriter,
  args: CreateArgs,
): Promise<CreateResult> {
  const { input, temporaryPassword, actorId, request } = args;

  const { full } = await capacity(db);

  if (full) {
    throw conflict(
      "admin_limit_reached",
      `There are already ${MAX_ADMIN_USERS} active administrators. Deactivate one before adding another.`,
    );
  }

  const [existing] = await db
    .select({ id: adminUsers.id, isActive: adminUsers.isActive })
    .from(adminUsers)
    .where(eq(adminUsers.email, input.email))
    .limit(1);

  if (existing) {
    throw conflict(
      "email_in_use",
      existing.isActive
        ? "Somebody already uses that email address."
        : "A retired account already uses that address. Reactivate it instead of making a second one.",
    );
  }

  // Hashing is deliberately slow, so it happens before anything is written.
  const passwordHash = await auth.hashPassword(temporaryPassword);
  const user = await auth.createUser({
    name: input.fullName,
    email: input.email,
  });

  try {
    await auth.createCredentialAccount({ userId: user.id, passwordHash });

    return await db.transaction(async (tx) => {
      // Re-counted inside the transaction, so two people adding the sixth
      // administrator at the same moment cannot both win.
      const [inside] = await tx
        .select({ n: count() })
        .from(adminUsers)
        .where(eq(adminUsers.isActive, true));

      if ((inside?.n ?? 0) >= MAX_ADMIN_USERS) {
        throw conflict(
          "admin_limit_reached",
          `There are already ${MAX_ADMIN_USERS} active administrators.`,
        );
      }

      const [created] = await tx
        .insert(adminUsers)
        .values({
          email: input.email,
          fullName: input.fullName,
          role: input.role,
          authUserId: user.id,
          // Somebody else knows this password, so it is not yet theirs.
          forcePasswordChange: true,
        })
        .returning({ id: adminUsers.id });

      await tx.insert(auditLog).values({
        actorType: "admin",
        actorId,
        action: "admin.created",
        entity: "admin_users",
        entityId: created.id,
        after: {
          email: input.email,
          fullName: input.fullName,
          role: input.role,
          via: "user-management",
        },
        ip: request?.ip ?? null,
        userAgent: request?.userAgent ?? null,
      });

      return { adminUserId: created.id };
    });
  } catch (error) {
    // Undo the Better Auth half, so a failure leaves no credential nobody can
    // reach and no address quietly taken.
    await auth.deleteUser(user.id).catch(() => undefined);
    throw error;
  }
}

/** The row, or a not found error. Used by every function below. */
async function require(db: Db, adminUserId: string) {
  const [row] = await db
    .select({
      id: adminUsers.id,
      email: adminUsers.email,
      fullName: adminUsers.fullName,
      role: adminUsers.role,
      isActive: adminUsers.isActive,
      isSuper: adminUsers.isSuper,
      authUserId: adminUsers.authUserId,
    })
    .from(adminUsers)
    .where(eq(adminUsers.id, adminUserId))
    .limit(1);

  if (!row) {
    throw notFound("admin_not_found", "That administrator does not exist.");
  }

  return row;
}

export type UpdateArgs = {
  adminUserId: string;
  input: UpdateAdminUserInput;
  actorId: string;
  /** Whether the caller may change somebody's role at all. */
  mayChangeRole: boolean;
  request?: AuditContext;
};

/**
 * Changes a name, a role, or both.
 *
 * The super administrator's role is fixed. Demoting it would leave an account
 * carrying the flag with a role the check constraint forbids, and the database
 * would refuse the write anyway; refusing it here says why.
 */
export async function update(db: Db, args: UpdateArgs): Promise<void> {
  const { adminUserId, input, actorId, mayChangeRole, request } = args;

  const before = await require(db, adminUserId);

  const changingRole =
    input.role !== undefined && input.role !== before.role;

  if (changingRole && !mayChangeRole) {
    throw rejected(
      "role_change_forbidden",
      "Only the super administrator can change somebody's role.",
    );
  }

  if (changingRole && before.isSuper) {
    throw rejected(
      "super_role_fixed",
      "The super administrator's role cannot be changed.",
    );
  }

  const fullName = input.fullName ?? before.fullName;
  const role = changingRole ? input.role! : before.role;

  if (fullName === before.fullName && role === before.role) return;

  await db.transaction(async (tx) => {
    await tx
      .update(adminUsers)
      .set({ fullName, role })
      .where(eq(adminUsers.id, adminUserId));

    await tx.insert(auditLog).values({
      actorType: "admin",
      actorId,
      action: "admin.updated",
      entity: "admin_users",
      entityId: adminUserId,
      before: { fullName: before.fullName, role: before.role },
      after: { fullName, role, email: before.email },
      ip: request?.ip ?? null,
      userAgent: request?.userAgent ?? null,
    });
  });
}

export type ResetPasswordArgs = {
  adminUserId: string;
  temporaryPassword: string;
  actorId: string;
  request?: AuditContext;
};

/**
 * Gives somebody a new temporary password and ends their sessions.
 *
 * Ending the sessions is the point. A password reset that leaves the old
 * sessions alive has not taken anything back from whoever was using them, and
 * the commonest reason to reset a password is that somebody should no longer be
 * signed in.
 *
 * The new password is never written to audit_log. The row records that a reset
 * happened and who did it, which is what a journal is for.
 */
export async function resetPassword(
  db: Db,
  auth: AuthAccountWriter,
  args: ResetPasswordArgs,
): Promise<void> {
  const { adminUserId, temporaryPassword, actorId, request } = args;

  const target = await require(db, adminUserId);

  if (!target.authUserId) {
    throw conflict(
      "no_credential",
      "That account has no sign in credential to reset.",
    );
  }

  const passwordHash = await auth.hashPassword(temporaryPassword);
  const authUserId = target.authUserId;

  await db.transaction(async (tx) => {
    const updated = await tx
      .update(authAccounts)
      .set({ password: passwordHash })
      .where(
        and(
          eq(authAccounts.userId, authUserId),
          eq(authAccounts.providerId, "credential"),
        ),
      )
      .returning({ id: authAccounts.id });

    if (updated.length === 0) {
      throw conflict(
        "no_credential",
        "That account has no sign in credential to reset.",
      );
    }

    await tx
      .update(adminUsers)
      .set({ forcePasswordChange: true })
      .where(eq(adminUsers.id, adminUserId));

    await tx.delete(authSessions).where(eq(authSessions.userId, authUserId));

    await tx.insert(auditLog).values({
      actorType: "admin",
      actorId,
      action: "admin.password_reset",
      entity: "admin_users",
      entityId: adminUserId,
      after: {
        email: target.email,
        sessionsEnded: true,
        forcePasswordChange: true,
      },
      ip: request?.ip ?? null,
      userAgent: request?.userAgent ?? null,
    });
  });
}

export type ChangeOwnPasswordArgs = {
  adminUserId: string;
  currentPassword: string;
  newPassword: string;
  request?: AuditContext;
};

/**
 * Somebody setting their own password, which clears the forced change.
 *
 * Their own sessions are deliberately left alone. Ending them would sign
 * somebody out of the screen they are standing at the moment they did the right
 * thing, which teaches people not to do it.
 */
export async function changeOwnPassword(
  db: Db,
  auth: AuthAccountWriter,
  args: ChangeOwnPasswordArgs,
): Promise<void> {
  const { adminUserId, currentPassword, newPassword, request } = args;

  const me = await require(db, adminUserId);

  if (!me.authUserId) {
    throw conflict("no_credential", "That account has no password to change.");
  }

  const authUserId = me.authUserId;
  const correct = await auth.verifyPassword({
    userId: authUserId,
    password: currentPassword,
  });

  if (!correct) {
    throw rejected(
      "wrong_password",
      "That is not your current password.",
    );
  }

  const passwordHash = await auth.hashPassword(newPassword);

  await db.transaction(async (tx) => {
    await tx
      .update(authAccounts)
      .set({ password: passwordHash })
      .where(
        and(
          eq(authAccounts.userId, authUserId),
          eq(authAccounts.providerId, "credential"),
        ),
      );

    await tx
      .update(adminUsers)
      .set({ forcePasswordChange: false })
      .where(eq(adminUsers.id, adminUserId));

    await tx.insert(auditLog).values({
      actorType: "admin",
      actorId: adminUserId,
      action: "admin.password_changed",
      entity: "admin_users",
      entityId: adminUserId,
      after: { email: me.email, self: true },
      ip: request?.ip ?? null,
      userAgent: request?.userAgent ?? null,
    });
  });
}

export type DeactivateArgs = {
  adminUserId: string;
  actorId: string;
  request?: AuditContext;
};

/**
 * Retires an account.
 *
 * Never a delete. The row is referenced by every audit entry this person ever
 * wrote and by every payment they recorded, and removing it would either break
 * those references or quietly take their name off their own work. Deactivating
 * ends the sessions and refuses the next sign in, which is the whole of what
 * deleting was ever meant to achieve.
 *
 * Two accounts cannot be retired: the super administrator, because the portal
 * would be left with nobody able to create one, and your own, because an
 * administrator who locks themselves out at four in the afternoon has nobody to
 * let them back in.
 */
export async function deactivate(
  db: Db,
  args: DeactivateArgs,
): Promise<void> {
  const { adminUserId, actorId, request } = args;

  const target = await require(db, adminUserId);

  if (target.isSuper) {
    throw rejected(
      "super_protected",
      "The super administrator cannot be deactivated.",
    );
  }

  if (adminUserId === actorId) {
    throw rejected(
      "self_deactivate",
      "You cannot deactivate your own account. Ask another administrator.",
    );
  }

  if (!target.isActive) return;

  /*
   * Deactivating is the one thing in the portal that takes every sign in
   * method away at once: the sessions go and the next attempt is refused
   * whichever door it comes to. So it answers to the same rule an unlink
   * would, and the two guards above are that rule's first two cases.
   *
   * This is the third, and it is a belt and braces check rather than a new
   * policy: a target who is neither the super administrator nor the caller
   * still has somebody able to reactivate them, so it cannot fire today. It
   * is here so that canRemoveSignInMethod has a caller in the product and not
   * only in the suite, and so the rule is enforced in one place when an
   * unlink action arrives.
   */
  const methods = await signInMethods(db, adminUserId);

  if (!canRemoveSignInMethod(methods) && !(await anotherAdminExists(db, adminUserId))) {
    throw rejected(
      "last_sign_in_method",
      "That is the only administrator left and the only way into the portal. Add another administrator first.",
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .update(adminUsers)
      .set({ isActive: false })
      .where(eq(adminUsers.id, adminUserId));

    if (target.authUserId) {
      await tx
        .delete(authSessions)
        .where(eq(authSessions.userId, target.authUserId));
    }

    await tx.insert(auditLog).values({
      actorType: "admin",
      actorId,
      action: "admin.deactivated",
      entity: "admin_users",
      entityId: adminUserId,
      before: { isActive: true },
      after: {
        isActive: false,
        email: target.email,
        role: target.role,
        sessionsEnded: true,
      },
      ip: request?.ip ?? null,
      userAgent: request?.userAgent ?? null,
    });
  });
}

/** Brings a retired account back, if there is room for it. */
export async function reactivate(
  db: Db,
  args: DeactivateArgs,
): Promise<void> {
  const { adminUserId, actorId, request } = args;

  const target = await require(db, adminUserId);

  if (target.isActive) return;

  const { full } = await capacity(db);

  if (full) {
    throw conflict(
      "admin_limit_reached",
      `There are already ${MAX_ADMIN_USERS} active administrators.`,
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .update(adminUsers)
      .set({ isActive: true })
      .where(eq(adminUsers.id, adminUserId));

    await tx.insert(auditLog).values({
      actorType: "admin",
      actorId,
      action: "admin.reactivated",
      entity: "admin_users",
      entityId: adminUserId,
      before: { isActive: false },
      after: { isActive: true, email: target.email, role: target.role },
      ip: request?.ip ?? null,
      userAgent: request?.userAgent ?? null,
    });
  });
}

/** Whether anybody other than this account is an active administrator. */
export async function anotherAdminExists(
  db: Db,
  exceptId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ n: count() })
    .from(adminUsers)
    .where(
      and(
        eq(adminUsers.role, "admin"),
        eq(adminUsers.isActive, true),
        ne(adminUsers.id, exceptId),
      ),
    );

  return (row?.n ?? 0) > 0;
}
