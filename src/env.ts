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
  ADMIN_SECRET: z
    .string({ error: "required. A long random string that unlocks the admin screen." })
    .min(24, "must be at least 24 characters. Generate one, do not invent one."),
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
      ADMIN_SECRET: process.env.ADMIN_SECRET,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
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
