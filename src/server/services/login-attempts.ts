import { and, desc, eq, gte, sql } from "drizzle-orm";

import type { Db } from "@/db";
import { adminLoginAttempts } from "@/db/schema";

/**
 * The per email login lockout.
 *
 * Better Auth's own limiter keys on ip and path and counts every request rather
 * than every failure, so it cannot express the rule CLAUDE.md and the brief
 * both ask for: five failures for one account in fifteen minutes. This can.
 *
 * Only failures are recorded, and a success clears the account's rows, so a row
 * count is always the number of consecutive failures. Counting from the
 * database rather than memory means a lockout survives a redeploy and holds
 * across every serverless instance, which an in process counter would not.
 *
 * Plain functions taking a db handle, per the architecture rule in CLAUDE.md.
 * Nothing here touches Request, cookies or next/headers.
 */

export const MAX_FAILURES = 5;
export const WINDOW_SECONDS = 60 * 15;

export type LockoutState = {
  locked: boolean;
  failures: number;
  /** Whole seconds until the oldest failure in the window ages out. */
  retryAfterSeconds: number;
};

function windowStart(): Date {
  return new Date(Date.now() - WINDOW_SECONDS * 1000);
}

/**
 * How many failures this email has inside the window, and whether that locks
 * it. Call before checking a password, and refuse when locked.
 */
export async function getLockoutState(
  db: Db,
  input: { email: string },
): Promise<LockoutState> {
  const since = windowStart();

  const rows = await db
    .select({ at: adminLoginAttempts.at })
    .from(adminLoginAttempts)
    .where(
      and(
        eq(adminLoginAttempts.email, input.email),
        gte(adminLoginAttempts.at, since),
      ),
    )
    .orderBy(desc(adminLoginAttempts.at));

  const failures = rows.length;
  const locked = failures >= MAX_FAILURES;

  // The lock lifts when the oldest failure still in the window ages out.
  const oldest = rows[rows.length - 1]?.at;
  const retryAfterSeconds =
    locked && oldest
      ? Math.max(
          0,
          Math.ceil(
            (oldest.getTime() + WINDOW_SECONDS * 1000 - Date.now()) / 1000,
          ),
        )
      : 0;

  return { locked, failures, retryAfterSeconds };
}

/** Records one failed attempt. Called after the credentials are rejected. */
export async function recordFailure(
  db: Db,
  input: { email: string; ip: string | null; userAgent: string | null },
): Promise<void> {
  await db.insert(adminLoginAttempts).values({
    email: input.email,
    ip: input.ip,
    userAgent: input.userAgent,
  });
}

/**
 * Clears the account's failures. Called after a password is accepted, so a
 * user who fumbles a password twice and then gets it right starts clean.
 */
export async function clearFailures(
  db: Db,
  input: { email: string },
): Promise<void> {
  await db
    .delete(adminLoginAttempts)
    .where(eq(adminLoginAttempts.email, input.email));
}

/**
 * Deletes attempts older than the window, for anyone who wants to keep the
 * table small. Nothing calls this yet: the rows are tiny and the index is on
 * (email, at), so a sweep is a housekeeping job rather than a correctness one.
 */
export async function pruneExpired(db: Db): Promise<number> {
  const result = await db
    .delete(adminLoginAttempts)
    .where(sql`${adminLoginAttempts.at} < ${windowStart()}`);
  return result.rowCount ?? 0;
}
