/**
 * Cookie names, and nothing else.
 *
 * This module exists so the middleware can name the cookies it looks for
 * without importing anything else. Importing them from lib/auth or
 * lib/admin-session instead pulled better-auth, drizzle, the Neon driver and
 * node:crypto into the edge bundle, taking the middleware to 323 kB for the
 * sake of two strings.
 *
 * Nothing here may gain an import.
 */

/** The Better Auth session cookie. Set in advanced.cookies.session_token. */
export const AUTH_SESSION_COOKIE = "admin-session";
