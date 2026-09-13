import { z } from "zod";

/**
 * Environment contract for the whole app.
 *
 * Split in two, because the two halves are available at different times.
 *
 * Public keys are inlined by Next at build time and are read at module scope,
 * for example by src/lib/metadata.ts, so they are validated eagerly and a
 * missing one still fails the build rather than a request.
 *
 * Server keys are not reliably present while `next build` collects page data
 * on Vercel, and validating them at module scope failed the production build
 * even though the variables were configured. They are validated on first
 * access instead and the result is cached, so the throw still happens, just at
 * the moment something actually needs the value.
 *
 * Each key is read explicitly rather than by spreading process.env, because
 * Next only inlines NEXT_PUBLIC_ values that appear as static references.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z
    .url("required. The public origin of the site, for example https://pledge.newlifesdanairobi.org"),
});

const serverSchema = z.object({
  DATABASE_URL: z
    .string({ error: "required. The Neon Postgres connection string." })
    .min(1, "required. The Neon Postgres connection string."),
  BETTER_AUTH_SECRET: z
    .string({ error: "required. The signing key for Better Auth sessions." })
    .min(32, "must be at least 32 characters. Generate one, do not invent one."),
  /*
   * The origin Better Auth is actually being served from. Defaults to the
   * public site URL, which is right everywhere except a local server: the
   * protocol decides whether cookies get the __Secure- prefix, so pointing a
   * localhost server at the https production URL makes it issue cookies the
   * browser then refuses to store.
   */
  BETTER_AUTH_URL: z.url().optional(),
  /*
   * The shared secret the daily snapshot job presents.
   *
   * Optional, because a local server has no scheduler pointed at it and the
   * route refuses every request when this is unset, which is the safe way for
   * it to be missing. In production it is required: without it the job cannot
   * authenticate and the snapshot never gets written.
   */
  CRON_SECRET: z.string().min(32, "must be at least 32 characters.").optional(),
  /*
   * Cloudflare Turnstile, the bot check standing in front of the pledge form.
   *
   * Both are optional and both are read together. Set, they gate every pledge:
   * a submission without a token that Cloudflare accepts is refused. Unset,
   * verification is skipped entirely so the form works on a laptop with no
   * Cloudflare account. See isTurnstileConfigured, which refuses to treat a
   * half configured pair as either state, and turnstileBypassAllowed, which
   * refuses to skip the check in production.
   *
   * The site key is not secret and is rendered into the widget. It is a server
   * key here rather than a NEXT_PUBLIC_ one on purpose: the pledge page is a
   * server component and hands it to the form as a prop, so the name stays the
   * one Cloudflare prints on the dashboard and no build time inlining is
   * involved.
   */
  TURNSTILE_SITE_KEY: z.string().optional(),
  TURNSTILE_SECRET_KEY: z.string().optional(),
  /*
   * Google, the second way into the admin portal.
   *
   * Both are optional and both are read together, the same shape as the
   * Turnstile pair above. Set, the sign in page offers a Google button and the
   * callback is gated by the allowlist in admin-google.ts. Unset, the button
   * does not render and email and password carries on unchanged, which is what
   * a laptop with no Google project wants.
   *
   * Unlike Turnstile there is no production requirement here, because absence
   * closes a door rather than opening one. A deploy that forgets these has one
   * working sign in method instead of two. A half configured pair is still an
   * error: see isGoogleConfigured, which refuses to guess which half was meant.
   *
   * These are server keys, not NEXT_PUBLIC_ ones. Neither is inlined into the
   * browser bundle: the client id travels in the redirect Better Auth builds on
   * the server, and the login page is told only whether the button should
   * render, never the value.
   */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /*
   * The ceiling for approving a pledge without a person looking at it, in whole
   * shillings. A pledge whose total lands under this is verified on submission.
   * Anything at or above it waits for the treasurer.
   *
   * Read as a string and coerced, because everything in process.env is a string
   * and an unparseable value must fail loudly rather than quietly become NaN
   * and auto approve nothing, or worse, everything.
   */
  PLEDGE_AUTO_APPROVE_LIMIT_KES: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === "" ? 5_000_000 : Number(value)))
    .pipe(
      z
        .number("must be a whole number of shillings.")
        .int("must be a whole number of shillings.")
        .positive("must be greater than zero."),
    ),
  /*
   * Where crash reports go, or nothing.
   *
   * Optional, and an empty string is a legitimate value rather than a mistake:
   * a laptop has no Sentry project and the SDK treats a missing DSN as "stay
   * switched off", which is what local development wants. Unset on Vercel it
   * means production reports nothing, which is a gap rather than a danger, so
   * it is not required the way the Turnstile keys are.
   *
   * Declared here so the shape is validated in one place and a mistyped DSN
   * fails loudly. The Sentry configs themselves read process.env directly: they
   * run inside instrumentation, before a request exists, and touching this
   * contract there would validate every other server key at a moment when Next
   * does not reliably have them. See the note at the top of this file.
   */
  SENTRY_DSN: z.union([z.literal(""), z.url("must be a Sentry DSN url.")]).optional(),
  /*
   * Resend, which sends the pledge confirmation email.
   *
   * Optional, and its absence is a working configuration rather than a broken
   * one: with no key the app records pledges exactly as before and simply does
   * not send anything. A confirmation email is a courtesy on top of a pledge
   * that is already safely in the database and already on screen, so a missing
   * key must never be able to refuse a pledge. That is why this is not treated
   * the way the Turnstile pair is, where absence in production is a failed
   * deploy.
   *
   * An empty string counts as absent, because a Vercel project with the
   * variable declared but blank is the same situation as one without it.
   */
  RESEND_API_KEY: z.string().optional(),
  /*
   * The From address on that email. Defaults to the development office, which
   * is the address the footer of the message already tells people to reply to.
   *
   * Whatever this is set to has to be a domain verified in the Resend
   * dashboard, or Resend refuses the send. That failure is logged and dropped,
   * per the note on the send function.
   */
  RESEND_FROM_EMAIL: z
    .string()
    .optional()
    .transform((value) =>
      value === undefined || value.trim() === ""
        ? "Crystal Fountain <churchdevelopment@newlifesdanairobi.org>"
        : value.trim(),
    ),
});

type PublicEnv = z.infer<typeof publicSchema>;
type ServerEnv = z.infer<typeof serverSchema>;

function fail(error: z.ZodError): never {
  const problems = error.issues
    .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");

  throw new Error(
    [
      "Environment validation failed. The following keys are missing or invalid:",
      problems,
      "",
      "Copy .env.example to .env.local and fill in the values.",
    ].join("\n"),
  );
}

const parsedPublic = publicSchema.safeParse({
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
});

if (!parsedPublic.success) fail(parsedPublic.error);

const publicEnv: PublicEnv = parsedPublic.data;

let serverEnv: ServerEnv | undefined;

function getServerEnv(): ServerEnv {
  if (!serverEnv) {
    const parsed = serverSchema.safeParse({
      DATABASE_URL: process.env.DATABASE_URL,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
      CRON_SECRET: process.env.CRON_SECRET,
      TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY,
      TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
      PLEDGE_AUTO_APPROVE_LIMIT_KES: process.env.PLEDGE_AUTO_APPROVE_LIMIT_KES,
      SENTRY_DSN: process.env.SENTRY_DSN,
      RESEND_API_KEY: process.env.RESEND_API_KEY,
      RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
    });
    if (!parsed.success) fail(parsed.error);
    serverEnv = parsed.data;
  }
  return serverEnv;
}

export type Env = PublicEnv & ServerEnv;

/**
 * Reads exactly as it always did. A public key is answered from the eager
 * parse, a server key triggers the lazy one on first access.
 */
export const env: Env = new Proxy({} as Env, {
  get(_target, property) {
    if (property in publicEnv) {
      return publicEnv[property as keyof PublicEnv];
    }
    return getServerEnv()[property as keyof ServerEnv];
  },
  has(_target, property) {
    return property in publicEnv || property in getServerEnv();
  },
});
