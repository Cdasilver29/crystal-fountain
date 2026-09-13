import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { twoFactor } from "better-auth/plugins/two-factor";

import { db } from "@/db";
import * as schema from "@/db/schema";
import { env } from "@/env";
import { clientIp } from "@/lib/api";
import { AUTH_SESSION_COOKIE } from "@/lib/auth-cookies";
import * as audit from "@/server/services/admin-audit";
import * as google from "@/server/services/admin-google";

/**
 * The caller IP for an audit row, reusing the same parser the route handlers
 * use. audit_log.ip is an inet column, so anything that is not plausibly an
 * address has to become null rather than poison the insert.
 */
function requestIp(context: { request?: Request } | null): string | null {
  return context?.request ? clientIp(context.request) : null;
}

/** The shape of the endpoint context Better Auth hands a database hook. */
type HookContext = {
  request?: Request;
  path?: string;
  headers?: Headers;
} | null;

/**
 * Whether this hook is firing inside a social sign in.
 *
 * Better Auth registers the handler as "/callback/:id" and the generic OAuth
 * one as "/oauth2/callback/:id", so both the pattern and a resolved
 * "/callback/google" are matched rather than betting on which form the context
 * carries.
 *
 * Everything below is scoped to this on purpose. The password flow already has
 * its own gate in /api/admin/login, which refuses a retired account after the
 * password and before the portal, and the provisioning calls in
 * admin-users.ts and admin-setup.ts create a Better Auth user deliberately,
 * from our own code, with no endpoint context at all. Gating those here would
 * refuse the super administrator creating somebody, because at that moment the
 * admin_users row this asks for does not exist yet.
 */
function isSocialCallback(context: HookContext): boolean {
  const path = context?.path ?? "";
  return path.startsWith("/callback/") || path.startsWith("/oauth2/callback/");
}

/**
 * Turns a refused Google sign in into an audit row and an error the callback
 * can redirect on.
 *
 * The audit write goes through our own db handle rather than the library's, so
 * it is outside whatever transaction Better Auth has open and survives the
 * abort this throw causes. Unlike the audit hooks further down, a failure here
 * is not swallowed: those protect a good login from a bad audit insert, but
 * this one is the refusal itself, and a refusal that cannot be recorded must
 * still be a refusal.
 */
async function refuseGoogle(
  result: Extract<google.GoogleGateResult, { allowed: false }>,
  context: HookContext,
): Promise<never> {
  try {
    await audit.recordGoogleRejected(db, {
      email: result.email,
      reason: result.reason,
      adminUserId: result.adminUserId,
      ip: requestIp(context),
      userAgent: context?.request?.headers.get("user-agent") ?? null,
    });
  } catch (error) {
    console.error("audit admin.google_rejected failed", error);
  }

  throw new APIError("FORBIDDEN", {
    code: google.GOOGLE_REJECTED_CODE,
    message: google.GOOGLE_REJECTED_MESSAGE,
  });
}

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
 * as its user table: admin_users.id is a uuid, and mapping the two would put
 * role and is_active under Better Auth's lifecycle. admin_users instead gains
 * one nullable column, auth_user_id, pointing at the Better Auth user. Role,
 * permissions and the treasurer's existing rows stay exactly where they are.
 * The second factor lives entirely in the plugin's own table now; the
 * totp_secret column that predated it is gone.
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

  /*
   * Google is optional. With no keys the provider is simply not registered, so
   * /api/auth/sign-in/social has nothing to offer and the login page renders
   * no button, while email and password carries on exactly as before. A half
   * configured pair throws rather than guessing.
   */
  const googleEnabled = google.isGoogleConfigured({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  });

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

    /*
     * Google, when it is configured at all.
     *
     * The redirect URI is spelled out rather than left to the default so that
     * the value registered in the Google console and the value sent in the
     * authorisation request are visibly the same string. Google refuses the
     * whole exchange on a mismatch, and it is derived from the same baseURL
     * the cookies are, so a local run and production stay consistent.
     *
     * Registering the provider is not permission to use it. Every sign in
     * through it still has to pass the allowlist in the hooks below.
     */
    socialProviders: googleEnabled
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID ?? "",
            clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
            redirectURI: `${baseURL}/api/auth/callback/google`,
          },
        }
      : undefined,

    /*
     * Account linking, so an administrator who already has a password and then
     * signs in with Google lands on the row they already have instead of a
     * second one.
     *
     * Both settings are load bearing and neither is the default:
     *
     * trustedProviders names Google as an identity we accept an address from.
     * Default is an empty list, and without it linking depends on Google
     * having said email_verified, which is not something to leave to chance
     * for the account that opens the pledge ledger.
     *
     * requireLocalEmailVerified defaults to true, and every administrator here
     * is created with emailVerified false, because there is no mail round trip
     * in this portal and nothing has ever set it. Left at the default, linking
     * refuses for every existing administrator and Better Auth answers
     * "account not linked", which reads as a broken button rather than a
     * policy. Turning it off is safe here precisely because the allowlist
     * below is the real gate: the address has to already be an active
     * administrator, put there by a super administrator, before any of this is
     * reached.
     */
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
        requireLocalEmailVerified: false,
      },
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

    /*
     * Audit rows for the two events that do not pass through a route of ours.
     *
     * A session row is created at the exact moment a sign in completes, which
     * is after the password for an account with no second factor and after the
     * code for one with. Hanging admin.login off the row rather than off an
     * endpoint means both flows are covered and a half finished sign in is
     * not recorded as a success.
     *
     * Neither hook is allowed to fail the request it rides on. An audit write
     * that throws here would turn a good login into a 500, so both are caught
     * and logged. That is a deliberate trade: CLAUDE.md requires the row, but
     * locking the treasurer out because the audit insert failed would be the
     * worse outcome, and the failure is loud in the logs.
     */
    databaseHooks: {
      session: {
        create: {
          /*
           * The allowlist, for an address that already has a Better Auth user.
           *
           * This is the retired administrator and the linking case: the user
           * row is already committed, so the address is read back from it and
           * put to the gate. Better Auth creates the user inside a transaction
           * and the session outside it, which is what makes reading through
           * our own handle here safe.
           *
           * Scoped to the social callback. A password sign in reaches this
           * same hook, and gating it here would be a second, differently
           * worded refusal for a case /api/admin/login already handles, and
           * would fire during /admin/setup before the admin_users row exists.
           */
          before: async (session, context) => {
            if (!isSocialCallback(context)) return;

            const email = await google.emailForAuthUser(db, session.userId);
            const gate = await google.checkGoogleSignIn(db, {
              email: email ?? "",
            });

            if (!gate.allowed) await refuseGoogle(gate, context);
          },

          after: async (session, context) => {
            try {
              const admin = await audit.findAdminByAuthUserId(
                db,
                session.userId,
              );
              if (!admin) return;
              await audit.recordLoginSuccess(db, {
                adminUserId: admin.id,
                email: admin.email,
                role: admin.role,
                ip: session.ipAddress ?? requestIp(context),
                userAgent: session.userAgent ?? null,
              });
            } catch (error) {
              console.error("audit admin.login failed", error);
            }
          },
        },
      },
      user: {
        create: {
          /*
           * The allowlist, for an address Better Auth has never seen.
           *
           * This is the stranger: a Google account with no user row here at
           * all. Refusing at session creation would work, but it would work
           * one row too late, leaving an auth_users row behind for every
           * passer by who ever pressed the button. Refusing here means nothing
           * is written at all.
           *
           * An authorised address with no user row is allowed through and
           * linked in the after hook below, which is the only way an
           * administrator can reach this branch.
           */
          before: async (user, context) => {
            if (!isSocialCallback(context)) return;

            const gate = await google.checkGoogleSignIn(db, {
              email: typeof user.email === "string" ? user.email : "",
            });

            if (!gate.allowed) await refuseGoogle(gate, context);
          },

          after: async (user, context) => {
            if (!isSocialCallback(context)) return;

            /*
             * Fills auth_user_id when the admin_users row was somehow made
             * without one. Guarded inside the service so an existing link is
             * never overwritten, and a no op for every account created the
             * ordinary way, which already has its credential and its link.
             */
            try {
              const gate = await google.checkGoogleSignIn(db, {
                email: typeof user.email === "string" ? user.email : "",
              });
              if (!gate.allowed) return;

              await google.linkAuthUser(db, {
                adminUserId: gate.adminUserId,
                authUserId: user.id,
              });
            } catch (error) {
              console.error("linking admin_users.auth_user_id failed", error);
            }
          },
        },
        update: {
          after: async (user, context) => {
            // Only the enrolment transition is interesting, and the recorder
            // itself is guarded so it writes once.
            if (user.twoFactorEnabled !== true) return;
            try {
              const admin = await audit.findAdminByAuthUserId(db, user.id);
              if (!admin) return;
              await audit.recordTotpEnrolled(db, {
                adminUserId: admin.id,
                email: admin.email,
                ip: requestIp(context),
                userAgent: context?.request?.headers.get("user-agent") ?? null,
              });
            } catch (error) {
              console.error("audit admin.totp_enrolled failed", error);
            }
          },
        },
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
