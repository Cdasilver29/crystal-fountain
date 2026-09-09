import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins/two-factor";

import { db } from "@/db";
import * as schema from "@/db/schema";
import { env } from "@/env";
import { AUTH_SESSION_COOKIE } from "@/lib/auth-cookies";

/**
 * Better Auth server configuration.
 *
 * Nothing is constructed when this module is imported. Reading
 * env.BETTER_AUTH_SECRET at module scope would trigger the lazy server env
 * parse while `next build` collects page data, which is the failure the two
 * commits before this one were written to fix. The instance is built on first
 * call instead and cached from then on, exactly like getDb().
 *
 * Better Auth owns its own tables. It deliberately does not adopt admin_users
 * as its user table: admin_users.id is a uuid, its totp_secret column predates
 * the two factor plugin and means something different from the plugin's own
 * secret, and mapping the two would put role, is_active and totp_secret under
 * Better Auth's lifecycle. admin_users instead gains one nullable column,
 * auth_user_id, pointing at the Better Auth user. Role, permissions and the
 * treasurer's existing rows stay exactly where they are.
 */

function createAuth() {
  /*
   * Better Auth reads the protocol here to decide two things at once: whether
   * cookies are named __Secure-admin-session or plain admin-session, and which
   * origins it will accept a request from. Both have to match the origin the
   * server is really answering on, so BETTER_AUTH_URL overrides for a local
   * run and the public site URL is the default everywhere else.
   */
  const baseURL = env.BETTER_AUTH_URL ?? env.NEXT_PUBLIC_SITE_URL;
  const isSecureOrigin = baseURL.startsWith("https://");

  return betterAuth({
    appName: "Crystal Fountain",
    secret: env.BETTER_AUTH_SECRET,
    baseURL,
    basePath: "/api/auth",

    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.authUsers,
        session: schema.authSessions,
        account: schema.authAccounts,
        verification: schema.authVerifications,
        twoFactor: schema.authTwoFactors,
        rateLimit: schema.authRateLimits,
      },
    }),

    emailAndPassword: {
      enabled: true,
      // Nobody signs themselves up. The first admin comes from /admin/setup and
      // every later one from an admin, so the public sign up path stays shut.
      disableSignUp: true,
      // Better Auth's default hasher is scrypt, which CLAUDE.md permits.
      minPasswordLength: 12,
      requireEmailVerification: false,
    },

    session: {
      /*
       * Eight hours idle, twenty four hours absolute.
       *
       * expiresIn is the idle window: Better Auth extends it on use, so a
       * session that goes untouched for eight hours is dead. Better Auth has
       * no absolute cap of its own, so the twenty four hour ceiling is
       * enforced in getCurrentAdmin() against session.createdAt. Both halves
       * are needed; expiresIn alone would roll forward indefinitely.
       */
      expiresIn: 60 * 60 * 8,
      // Refresh at most every fifteen minutes rather than on every request, so
      // an admin browsing the pledge table is not one session write per click.
      updateAge: 60 * 15,
    },

    advanced: {
      cookies: {
        session_token: { name: AUTH_SESSION_COOKIE },
      },
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        /*
         * Tied to the origin's protocol rather than NODE_ENV. They have to
         * agree: the __Secure- name prefix Better Auth adds on an https origin
         * is only legal on a cookie that also carries Secure, and a browser
         * drops the cookie outright when they disagree. NODE_ENV would get
         * this wrong for `pnpm start` on localhost, which is production mode
         * on a plain http origin.
         */
        secure: isSecureOrigin,
        path: "/",
      },
    },

    /*
     * Better Auth's own limiter, keyed on ip and path. It is a blunt second
     * layer and not the requirement: it counts every request rather than every
     * failure, and it cannot key on an email address, so five failures for one
     * account cannot be told apart from five people on one office router.
     *
     * The per email rule lives in src/server/services/login-attempts.ts and is
     * enforced by the login route. This is here to blunt a distributed guess
     * against many accounts from one address.
     */
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 30,
      customRules: {
        "/sign-in/email": { window: 60 * 15, max: 20 },
        "/two-factor/verify-totp": { window: 60 * 15, max: 20 },
      },
    },

    plugins: [
      twoFactor({
        issuer: "Crystal Fountain",
        // TOTP only. No email or sms one time codes: CLAUDE.md keeps SMS OTP
        // out of v1, and there is no mail sender wired up.
        totpOptions: { digits: 6, period: 30 },
        /*
         * The second factor's own lockout, matched to the password stage's
         * five in fifteen minutes. The password stage is handled by
         * /api/admin/login against admin_login_attempts; this covers someone
         * who has the password and is guessing at the code.
         */
        accountLockout: {
          enabled: true,
          maxFailedAttempts: 5,
          durationSeconds: 60 * 15,
        },
      }),
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;

/** The Better Auth instance, built once on first use. */
export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}

export { AUTH_SESSION_COOKIE };

/** The absolute ceiling on a session, regardless of how recently it was used. */
export const AUTH_SESSION_ABSOLUTE_MAX_AGE_SECONDS = 60 * 60 * 24;
