import { count } from "drizzle-orm";

import type { Db } from "@/db";
import { adminUsers, auditLog, authUsers } from "@/db/schema";

/**
 * First run setup.
 *
 * Creating the first administrator spans two systems: Better Auth owns the
 * credential, admin_users owns the role.
 *
 * These cannot share one transaction. Better Auth's drizzle adapter holds its
 * own handle and there is no way to hand it our `tx`, so a single atomic write
 * across both is not on offer. What happens instead: the admin_users row and
 * its audit row go in together in a real transaction, and if that transaction
 * fails the Better Auth user created a moment earlier is deleted again. An
 * orphan would be worse than it sounds, because isSetupAvailable requires both
 * tables to be empty, so one would wedge /admin/setup shut for good.
 *
 * Better Auth is reached through the narrow interface below rather than
 * imported, which keeps this file to the rule in CLAUDE.md: a plain function
 * taking a db handle and a typed input, with no Request, Response, cookies or
 * next/headers anywhere in it. The route adapts Better Auth's context to it.
 */

export type AuthProvisioner = {
  hashPassword(password: string): Promise<string>;
  createUser(input: { name: string; email: string }): Promise<{ id: string }>;
  createCredentialAccount(input: {
    userId: string;
    passwordHash: string;
  }): Promise<void>;
  /** Compensating action, used only when the admin_users write fails. */
  deleteUser(userId: string): Promise<void>;
};

export type CreateFirstAdminInput = {
  fullName: string;
  email: string;
  password: string;
  ip: string | null;
  userAgent: string | null;
};

/**
 * Whether /admin/setup is still open.
 *
 * Both tables have to be empty. admin_users alone is not enough: a Better Auth
 * user with no admin row would otherwise leave the door open to a second
 * "first" admin.
 */
export async function isSetupAvailable(db: Db): Promise<boolean> {
  const [admins] = await db.select({ n: count() }).from(adminUsers);
  const [users] = await db.select({ n: count() }).from(authUsers);
  return (admins?.n ?? 0) === 0 && (users?.n ?? 0) === 0;
}

export type CreateFirstAdminResult =
  | { ok: true; adminUserId: string; authUserId: string }
  | { ok: false; reason: "already_set_up" };

export async function createFirstAdmin(
  db: Db,
  auth: AuthProvisioner,
  input: CreateFirstAdminInput,
): Promise<CreateFirstAdminResult> {
  if (!(await isSetupAvailable(db))) {
    return { ok: false, reason: "already_set_up" };
  }

  // Hash before anything is written. Scrypt is deliberately slow and holding a
  // connection open while it runs would be a waste of the pool.
  const passwordHash = await auth.hashPassword(input.password);

  const user = await auth.createUser({
    name: input.fullName,
    email: input.email,
  });

  try {
    await auth.createCredentialAccount({ userId: user.id, passwordHash });

    return await db.transaction(async (tx) => {
      /*
       * Re-checked inside the transaction. The checks on the page render and
       * in the route are advisory; this is the one that decides, so two setup
       * posts racing each other cannot both win.
       */
      const [admins] = await tx.select({ n: count() }).from(adminUsers);

      if ((admins?.n ?? 0) > 0) {
        throw new SetupRaceLost();
      }

      const [admin] = await tx
        .insert(adminUsers)
        .values({
          email: input.email,
          fullName: input.fullName,
          role: "admin",
          authUserId: user.id,
        })
        .returning({ id: adminUsers.id });

      if (!admin) throw new Error("admin_users insert returned no row");

      // CLAUDE.md: every admin write appends an audit row. No exceptions.
      await tx.insert(auditLog).values({
        actorType: "admin",
        actorId: admin.id,
        action: "admin.created",
        entity: "admin_users",
        entityId: admin.id,
        after: {
          email: input.email,
          fullName: input.fullName,
          role: "admin",
          via: "first-run-setup",
        },
        ip: input.ip,
        userAgent: input.userAgent,
      });

      return { ok: true as const, adminUserId: admin.id, authUserId: user.id };
    });
  } catch (error) {
    // Undo the Better Auth half, so a failure here leaves setup open rather
    // than wedged shut behind a user nobody can sign in as.
    await auth.deleteUser(user.id).catch(() => undefined);
    if (error instanceof SetupRaceLost) {
      return { ok: false, reason: "already_set_up" };
    }
    throw error;
  }
}

/** Thrown when another setup post got there first. Never leaves this module. */
class SetupRaceLost extends Error {}
