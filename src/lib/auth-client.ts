"use client";

import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

/**
 * The browser half of Better Auth.
 *
 * Only the two factor calls go through this. The password stage posts to
 * /api/admin/login instead, because the per email lockout has to wrap it.
 *
 * No baseURL is set: the client defaults to the current origin, which is what
 * this is always talking to, and hardcoding one would break preview
 * deployments. Nothing is written to localStorage; the session lives in the
 * httpOnly cookie the server sets, per CLAUDE.md.
 */
export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [twoFactorClient()],
});
