import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { authAccounts } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import type { AuthAccountWriter } from "@/server/services/admin-users";

/**
 * Better Auth, adapted to the narrow interface the user service takes.
 *
 * The service stays free of the library, per the architecture rule in
 * CLAUDE.md, and the adapting happens once here rather than being copied into
 * every route that needs it. admin-setup keeps its own inline version because
 * it needs a different subset and runs before anybody is signed in.
 */
export async function authAccountWriter(): Promise<AuthAccountWriter> {
  const ctx = await getAuth().$context;

  return {
    hashPassword: (password) => ctx.password.hash(password),

    createUser: async ({ name, email }) => {
      const user = await ctx.internalAdapter.createUser(
        { name, email, emailVerified: false },
        { method: "email-password" },
      );
      return { id: user.id };
    },

    createCredentialAccount: async ({ userId, passwordHash }) => {
      await ctx.internalAdapter.createAccount({
        userId,
        // Better Auth looks the credential up by this provider id.
        providerId: "credential",
        accountId: userId,
        password: passwordHash,
      });
    },

    deleteUser: async (userId) => {
      await ctx.internalAdapter.deleteUser(userId);
    },

    verifyPassword: async ({ userId, password }) => {
      const [account] = await db
        .select({ password: authAccounts.password })
        .from(authAccounts)
        .where(
          and(
            eq(authAccounts.userId, userId),
            eq(authAccounts.providerId, "credential"),
          ),
        )
        .limit(1);

      // No credential is not a wrong password, but it is certainly not a right
      // one, and there is nothing to compare against.
      if (!account?.password) return false;

      return ctx.password.verify({
        hash: account.password,
        password,
      });
    },
  };
}
