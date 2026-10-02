/**
 * Cleaning a name before it is stored, shared by every contract that takes
 * one, client and server.
 *
 * Names appear publicly, in the recent pledges feed and on /pledgers, so
 * what is stored is what the congregation reads. Three kinds of character
 * are removed because they are invisible and can only be there to mislead:
 *
 * - control characters, which have no business in a name;
 * - zero width characters, which make two names that look the same compare
 *   different and can hide text between letters;
 * - the invisible direction controls, U+202A to U+202E and U+2066 to U+2069,
 *   which can reverse or hide text in the public feed.
 *
 * Only those. Right to left letters are letters and are never touched, and
 * neither are the left to right and right to left marks, U+200E and U+200F,
 * which do not override anything. The name is composed to NFC first so a
 * letter typed as a base and an accent is stored as the one letter it looks
 * like, and whitespace is collapsed last, after anything that was hiding
 * between two spaces is gone.
 */

/** Line breaks and tabs are spacing a person typed, not part of the name. */
const TYPED_SPACING = /[\t\n\v\f\r\u0085\u2028\u2029]/g;

/** Every other control character, C0, DEL and C1. */
const CONTROL = /\p{Cc}/gu;

/**
 * Zero width space, non joiner and joiner, the word joiner, the Mongolian
 * vowel separator and the byte order mark.
 */
const ZERO_WIDTH = /[\u200B-\u200D\u2060\u180E\uFEFF]/g;

/** The embedding, override and isolate controls. Nothing else. */
const DIRECTION_CONTROL = /[\u202A-\u202E\u2066-\u2069]/g;

/** Whether a value carries anything cleanName removes outright. */
export function hasStrippableCharacters(value: string): boolean {
  return /[\p{Cc}\u200B-\u200D\u2060\u180E\uFEFF\u202A-\u202E\u2066-\u2069]/u.test(
    value,
  );
}

export function cleanName(value: string): string {
  return value
    .normalize("NFC")
    .replace(TYPED_SPACING, " ")
    .replace(CONTROL, "")
    .replace(ZERO_WIDTH, "")
    .replace(DIRECTION_CONTROL, "")
    .replace(/\s+/gu, " ")
    .trim();
}
