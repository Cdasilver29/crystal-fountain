import { z } from "zod";

/**
 * Environment contract for the whole app.
 *
 * This module is imported once from the root layout so that a missing or
 * malformed variable fails the build, not a request in front of a user.
 * Each key is read explicitly rather than by spreading process.env, because
 * Next only inlines NEXT_PUBLIC_ values that appear as static references.
 */
const envSchema = z.object({
  DATABASE_URL: z
    .string({ error: "required. The Neon Postgres connection string." })
    .min(1, "required. The Neon Postgres connection string."),
  NEXT_PUBLIC_SITE_URL: z
    .url("required. The public origin of the site, for example https://pledge.newlifesdanairobi.org"),
});

const parsed = envSchema.safeParse({
  DATABASE_URL: process.env.DATABASE_URL,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
});

if (!parsed.success) {
  const problems = parsed.error.issues
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

export const env = parsed.data;
export type Env = typeof env;
