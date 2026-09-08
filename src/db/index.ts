import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import { env } from "@/env";
import * as schema from "@/db/schema";

const sql = neon(env.DATABASE_URL);

export const db = drizzle(sql, { schema });

/**
 * The handle every service function in src/server takes as its first argument.
 * Services stay portable by depending on this type and nothing from Next.
 */
export type Db = typeof db;
