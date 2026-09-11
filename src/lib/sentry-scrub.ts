import type { ErrorEvent } from "@sentry/nextjs";

/**
 * What Sentry is allowed to be told.
 *
 * One module, so every runtime that reports scrubs identically. A rule that
 * held in one place and not another would be worse than no rule, because it
 * would look configured.
 *
 * Today that means the server config, and the client config whenever it is
 * switched on. There is no edge config: the middleware is not instrumented.
 *
 * This exists because of the privacy rules in CLAUDE.md. The congregation's
 * phone numbers are the identity key for every pledge and the numbers are not
 * secret within a church, so a crash report carrying one is a leak of exactly
 * the kind the public endpoints are written to prevent. An error report is not
 * a public endpoint, but it leaves the country and lands in a third party's
 * database, which is worse.
 *
 * Everything here is a plain function over a plain object. No Sentry client, no
 * request, no environment, so the rules can be tested without any of those.
 */

export const REDACTED = "[REDACTED]";

/**
 * Field names that are redacted wherever they appear in an event.
 *
 * Matched on a normalised key, so phone_e164, phoneE164 and Phone-E164 are all
 * the same field. The API speaks camelCase and the database speaks snake_case,
 * and an event can carry either, so matching only one spelling would cover half
 * the paths a number can travel.
 */
const REDACT_FIELDS = [
  "phone",
  "email",
  "phone_e164",
  "payer_phone",
  "payer_msisdn",
  "full_name",
  "payer_name",
  "display_name",
];

/**
 * Substrings that disqualify a request body key.
 *
 * Wider than the list above and deliberately so. A body is whatever somebody
 * posted, including shapes this code has never seen, so it is filtered on a
 * guess about the name rather than on a known list. "name" catches fullName and
 * payerName and also firstName and surname.
 */
const BODY_KEY_SUBSTRINGS = [
  "phone",
  "email",
  "name",
  "password",
  "secret",
  "token",
];

/** Headers that carry credentials and are dropped whole. */
const DROP_HEADERS = ["cookie", "authorization"];

/**
 * How deep to walk. Sentry has already normalised the event, so this is a guard
 * against a pathological object rather than an expected case.
 */
const MAX_DEPTH = 12;

/** Lowercased and stripped of separators, so key spellings compare equal. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_\-\s]/g, "");
}

const REDACT_SET = new Set(REDACT_FIELDS.map(normalizeKey));

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Replaces any value held under a named field, however deeply it sits.
 *
 * The key is redacted rather than removed. A report that says a phone number
 * was here is useful for debugging; the number itself is not.
 */
function redactNamedFields(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return value;

  if (Array.isArray(value)) {
    return value.map((entry) => redactNamedFields(entry, depth + 1));
  }

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = REDACT_SET.has(normalizeKey(key))
        ? REDACTED
        : redactNamedFields(entry, depth + 1);
    }
    return out;
  }

  return value;
}

/** The same walk, but matching body keys on a substring. */
function redactBodyKeys(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return value;

  if (Array.isArray(value)) {
    return value.map((entry) => redactBodyKeys(entry, depth + 1));
  }

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const normalized = normalizeKey(key);
      out[key] = BODY_KEY_SUBSTRINGS.some((bad) => normalized.includes(bad))
        ? REDACTED
        : redactBodyKeys(entry, depth + 1);
    }
    return out;
  }

  return value;
}

/**
 * A request body, scrubbed.
 *
 * A body that arrives as a string is parsed and scrubbed when it is JSON, which
 * is what this API speaks. A string that is not JSON is dropped whole rather
 * than searched: the only bodies that reach here unparseable are the malformed
 * ones the route already refuses, so there is nothing in them worth the risk of
 * guessing where a number starts and ends.
 */
function scrubBody(data: unknown): unknown {
  if (typeof data === "string") {
    try {
      const parsed: unknown = JSON.parse(data);
      return redactBodyKeys(parsed);
    } catch {
      return REDACTED;
    }
  }
  return redactBodyKeys(data);
}

/**
 * Strips an event of anything that identifies a pledger.
 *
 * Order matters. The request is handled specially first, because its body is
 * filtered more widely than the rest of the event, and then the whole event
 * gets the named field pass so nothing slips through in a breadcrumb, a tag,
 * an extra or a context.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    const request = { ...event.request };

    if (request.headers) {
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(request.headers)) {
        if (!DROP_HEADERS.includes(normalizeKey(key))) headers[key] = value;
      }
      request.headers = headers;
    }

    // Sentry keeps parsed cookies separately from the header they came from.
    delete request.cookies;

    if (request.data !== undefined) {
      request.data = scrubBody(request.data);
    }

    event.request = request;
  }

  /*
   * No IP address, ever. sendDefaultPii false already stops the SDK attaching
   * one, but Sentry's own ingest will infer an address from the sending
   * connection unless the event says otherwise, so it is nulled here as well.
   * Two ways of saying no, because only one of them is in this repository.
   */
  if (event.user) {
    const user = { ...event.user };
    delete user.ip_address;
    event.user = user;
  }

  return redactNamedFields(event) as ErrorEvent;
}

/**
 * The beforeSend hook itself, shared by all three runtimes.
 *
 * Kept as a named export rather than written inline three times, so that what
 * the verification script exercises is the same function the SDK calls.
 */
export function beforeSend(event: ErrorEvent): ErrorEvent {
  return scrubEvent(event);
}
