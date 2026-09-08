import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { env } from "@/env";

/**
 * Placeholder admin auth.
 *
 * A single shared secret, held until real per-user admin auth with TOTP lands.
 * The admin_users table already exists for that, and nothing here will survive
 * it. What it does get right, so the replacement inherits it:
 *
 * - the raw secret never goes in the cookie, only an HMAC derived from it
 * - comparison is timing safe
 * - the cookie is httpOnly, SameSite=Lax and Secure outside development
 *
 * Secure is relaxed in development only, because a Secure cookie is not stored
 * over plain http on localhost and the screen would be impossible to open.
 */

export const ADMIN_COOKIE = "cf_admin";
export const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

/** The value that goes in the cookie. Derived from the secret, never the secret. */
export function adminSessionToken(): string {
  return createHmac("sha256", env.ADMIN_SECRET)
    .update("crystal-fountain-admin-v1")
    .digest("hex");
}

/** Constant time compare. Hashing first keeps the lengths equal. */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
}

export function isValidSecret(candidate: string): boolean {
  return safeEqual(candidate, env.ADMIN_SECRET);
}

export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  const value = store.get(ADMIN_COOKIE)?.value;
  if (!value) return false;
  return safeEqual(value, adminSessionToken());
}

export function adminCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  };
}
