import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The cookie that says "this browser made this pledge".
 *
 * Not a login and not an identity. A phone number can be known by anybody and
 * a shared pledge link is forwarded into WhatsApp groups by design, so neither
 * proves that the person adding to a pledge is the one who made it. This
 * does, weakly: only the browser that submitted a pledge holds a cookie naming
 * it, signed with OWNER_COOKIE_SECRET so it cannot be written by hand. An
 * addition carrying it applies at once; every other addition is held for the
 * treasurer.
 *
 * At most ten pledge ids, newest kept, for ninety days. httpOnly, Secure and
 * SameSite=Lax, like the admin session cookie.
 *
 * With no secret configured the cookie is never set and never accepted, so
 * every addition is held. That is the safe way for this to be missing.
 *
 * Pure functions of their input, so they are tested without a request.
 */

export const OWNER_COOKIE_NAME = "cf_owner";
export const OWNER_COOKIE_MAX_IDS = 10;
export const OWNER_COOKIE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A secret too short to trust is treated as no secret at all. */
function usable(secret: string | undefined): secret is string {
  return typeof secret === "string" && secret.trim().length >= 32;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** The cookie value for these pledge ids, or null when there is no secret. */
export function encodeOwnerCookie(
  ids: readonly string[],
  secret: string | undefined,
  now: Date = new Date(),
): string | null {
  if (!usable(secret)) return null;

  const kept = [...new Set(ids.filter((id) => UUID.test(id)))].slice(-OWNER_COOKIE_MAX_IDS);
  const payload = Buffer.from(
    JSON.stringify({ ids: kept, iat: Math.floor(now.getTime() / 1000) }),
  ).toString("base64url");

  return `${payload}.${sign(payload, secret)}`;
}

/**
 * The pledge ids a cookie value proves, or none.
 *
 * Every failure reads as an empty list: a missing secret, a missing or
 * malformed value, a bad signature, or a cookie older than ninety days. None of
 * those is an error worth telling anybody about, and all of them mean the same
 * thing here, which is that this browser has proved nothing.
 */
export function decodeOwnerCookie(
  value: string | null | undefined,
  secret: string | undefined,
  now: Date = new Date(),
): string[] {
  if (!usable(secret) || !value) return [];

  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra !== undefined) return [];

  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return [];

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      ids?: unknown;
      iat?: unknown;
    };
    if (typeof parsed.iat !== "number") return [];
    if (now.getTime() / 1000 - parsed.iat > OWNER_COOKIE_MAX_AGE_SECONDS) return [];
    if (!Array.isArray(parsed.ids)) return [];
    return parsed.ids
      .filter((id): id is string => typeof id === "string" && UUID.test(id))
      .slice(-OWNER_COOKIE_MAX_IDS);
  } catch {
    return [];
  }
}

/** The value of one cookie from a Cookie header, without a parsing library. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/** The Set-Cookie header for these ids, or null when there is no secret. */
export function ownerSetCookie(
  ids: readonly string[],
  secret: string | undefined,
  now: Date = new Date(),
): string | null {
  const value = encodeOwnerCookie(ids, secret, now);
  if (value === null) return null;
  return [
    `${OWNER_COOKIE_NAME}=${value}`,
    "Path=/",
    `Max-Age=${OWNER_COOKIE_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}
