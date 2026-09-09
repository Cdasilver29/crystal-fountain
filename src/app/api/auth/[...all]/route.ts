import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/lib/auth";

/**
 * Better Auth's catch all handler.
 *
 * The instance is reached through a closure rather than passed directly, so
 * nothing is constructed while `next build` collects page data. toNextJsHandler
 * accepts a plain function for exactly this.
 */
export const dynamic = "force-dynamic";

export const { GET, POST } = toNextJsHandler((request: Request) =>
  getAuth().handler(request),
);
