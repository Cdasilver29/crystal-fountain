import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as Sentry from "@sentry/nextjs";

import { env } from "@/env";
import * as schema from "@/db/schema";

/**
 * Database client.
 *
 * This uses the WebSocket pool driver, not the http one. The http driver throws
 * "No transactions support in neon-http driver" on db.transaction(), and
 * CLAUDE.md requires that any operation touching money runs in a single
 * transaction or not at all. Creating a pledge writes a pledger, a pledge and
 * an audit row together, so it needs a real transaction.
 *
 * Nothing is constructed when this module is imported. `next build` evaluates
 * route modules while collecting page data, and building the pool at module
 * scope made that phase fail on Vercel with "Failed to collect page data for
 * /api/admin/pledges/[id]". The pool is built on the first real call instead,
 * and cached from then on, so a serverless invocation still makes at most one.
 */

function createDb() {
  // Node 22 and later expose WebSocket globally. Set it explicitly so the
  // driver does not have to guess, and leave it alone in runtimes that provide
  // their own.
  if (typeof globalThis.WebSocket !== "undefined") {
    neonConfig.webSocketConstructor = globalThis.WebSocket;
  }

  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    /*
     * Two connections. A Vercel function handles one request at a time, so a
     * single invocation never needs more than one connection plus a little
     * headroom while one is being replaced. Concurrency across invocations is
     * Neon's pooler's job, not ours, and a large max here just multiplies idle
     * connections across every warm instance.
     */
    max: 2,
    /*
     * Close an idle connection before Neon does. Neon's pooler and the
     * autosuspend both drop idle connections on their own schedule, and when
     * they win the race the client errors from under us. Ten seconds is
     * comfortably under their cutoff, so in the normal case we hang up first
     * and the error never happens, rather than only being caught below.
     */
    idleTimeoutMillis: 10_000,
    /*
     * Give up waiting for a connection after ten seconds. A suspended Neon
     * compute takes a few seconds to wake, which is worth waiting for, but
     * without a bound a request would hang until the platform killed it and
     * the visitor would just watch a spinner.
     */
    connectionTimeoutMillis: 10_000,
  });

  /*
   * An idle client dying is normal for a serverless pool against Neon and must
   * never crash the process. Without a listener here, node-postgres re-emits
   * the idle client's error on the pool, and an 'error' event with no listener
   * is an uncaught exception that takes the whole function down: that is what
   * Sentry caught on GET / in production. Log it and stop. Do not rethrow, and
   * do not exit. The pool discards the dead client and the next query opens a
   * fresh one.
   */
  pool.on("error", (error: Error) => {
    Sentry.captureException(error, { tags: { area: "db_pool_idle_client" } });
  });

  return drizzle(pool, { schema });
}

type DrizzleDb = ReturnType<typeof createDb>;

let instance: DrizzleDb | undefined;

/** The pool and drizzle instance, built once on first use. */
export function getDb(): DrizzleDb {
  instance ??= createDb();
  return instance;
}

/**
 * The same handle as getDb(), reached by property access.
 *
 * Every call site already reads `db.something`, so this stays a lazy stand in
 * rather than a rewrite of each of them: the first property read builds the
 * real instance and forwards to it. Methods are bound to the real instance so
 * drizzle's internals see the right `this`.
 */
export const db: DrizzleDb = new Proxy({} as DrizzleDb, {
  get(_target, property) {
    const real = getDb();
    const value = (real as unknown as Record<string | symbol, unknown>)[
      property
    ];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(real)
      : value;
  },
});

/**
 * The handle every service function in src/server takes as its first argument.
 * Services stay portable by depending on this type and nothing from Next.
 */
export type Db = DrizzleDb;

/** The handle handed to the callback inside db.transaction(). */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Either handle.
 *
 * A service that one other service has to call from inside its own transaction
 * takes this rather than Db, so the two commit or roll back together. Drizzle
 * turns a transaction opened on a Tx into a savepoint, so the inner service
 * keeps its own boundary without starting a second transaction that could
 * commit on its own.
 */
export type DbHandle = Db | Tx;
