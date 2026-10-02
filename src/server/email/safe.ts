/**
 * What every email template uses to put a value into a message safely.
 *
 * One copy, rather than the one each template used to carry, so a fix here is
 * a fix everywhere.
 */

/**
 * Escapes text going into markup, attribute values included.
 *
 * Every interpolated value goes through this, the constants from the content
 * file as much as anything a person typed, so nothing depends on remembering
 * which values are safe. The ampersand goes first so the escapes cannot
 * escape each other.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The longest first name a greeting will print. */
export const GREETING_NAME_MAX = 30;

/**
 * The first name, reduced until it cannot carry a web address.
 *
 * Escaping is not enough. A name typed as "Verify your M-Pesa at bit.ly/xyz"
 * survives escaping as plain text, and mail clients turn link shaped text
 * into a link, so the church's own sender would deliver a working phishing
 * link. Only letters, spaces, hyphens and apostrophes are kept, which is
 * every name and no address: with no dot, slash or colon nothing is link
 * shaped. Anything else becomes a space, so it splits words rather than
 * joining them, and only the first word is used, at most thirty characters.
 *
 * Letters in any script, so a name written in Arabic or Amharic is kept as it
 * is. Combining marks count as part of a letter.
 *
 * Null when nothing is left, and the caller greets the member generically.
 */
export function greetingName(fullName: string | null | undefined): string | null {
  const reduced = (fullName ?? "")
    .normalize("NFC")
    .replace(/[^\p{L}\p{M} '\u2019-]/gu, " ")
    .trim()
    .split(/\s+/)[0]
    // A name does not start or end with a hyphen or an apostrophe.
    ?.replace(/^['\u2019-]+|['\u2019-]+$/gu, "");

  if (!reduced) return null;

  // By code point, so a letter outside the basic plane is never cut in half.
  return Array.from(reduced).slice(0, GREETING_NAME_MAX).join("");
}

/** "Dear Jane", or "Dear member" when the name leaves nothing to greet. */
export function greeting(fullName: string | null | undefined): string {
  return `Dear ${greetingName(fullName) ?? "member"}`;
}
