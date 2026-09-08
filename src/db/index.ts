import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";

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
 */

// Node 22 and later expose WebSocket globally. Set it explicitly so the driver
// does not have to guess, and leave it alone in runtimes that provide their own.
if (typeof globalThis.WebSocket !== "undefined") {
  neonConfig.webSocketConstructor = globalThis.WebSocket;
}

const pool = new Pool({ connectionString: env.DATABASE_URL });

export const db = drizzle(pool, { schema });

/**
 * The handle every service function in src/server takes as its first argument.
 * Services stay portable by depending on this type and nothing from Next.
 */
export type Db = typeof db;

/** The handle handed to the callback inside db.transaction(). */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
