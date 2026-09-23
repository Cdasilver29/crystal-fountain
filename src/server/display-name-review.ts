import { displayName } from "@/server/display-name";

/**
 * Which public names the treasurer should read again.
 *
 * The derivation in display-name.ts gets most of the campaign's names right,
 * but some stored names are not shaped like a name at all: "The Nzioki's
 * Family" comes out as "The F.", "Shimrone Munga Family" as "Shimrone F.", and
 * "SAMUEL NGOA" as "SAMUEL N." beside sentence case neighbours. This picks
 * those out so they can be fixed by hand before the congregation reads them.
 *
 * It flags; it never fixes. Whatever it says, the published name stays what
 * displayName renders until a person sets a public_display_name.
 *
 * Typos are deliberately out of scope. "Petet Otieno" is shaped exactly like a
 * real name, and a spell check over Kenyan names would flag most of the list,
 * so those are left to the treasurer reading every row.
 *
 * A plain function with no database and no Next imports, beside
 * display-name.ts, so the list service and any later screen agree on it.
 */

export type NameReviewReason =
  | "title or word treated as a name"
  | "all capitals"
  | "surname replaced by the word Family"
  | "contains a slash"
  | "no surname";

/** The pledger fields the check reads. */
export type NameReviewInput = {
  /** What the pledger typed, the string the public name is derived from. */
  storedName: string;
  displayConsent: boolean;
  isOrganisation: boolean;
  /** The hand set name, if any. */
  publicDisplayName: string | null;
};

/**
 * Words that are not a given name.
 *
 * Checked against the derived name, not the stored one: "Mr. Steve Mogere"
 * derives cleanly to "Steve M." and is fine, while "Mr &Mrs Abuga." derives to
 * "Mr & Mrs A.", which is not.
 */
const NOT_A_NAME: ReadonlySet<string> = new Set([
  "family",
  "the",
  "mr",
  "mrs",
  "miss",
  "dr",
  "prof",
  "pastor",
  "elder",
  "rev",
]);

/** A word with its surrounding punctuation dropped, lower cased. */
function bare(word: string): string {
  return word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "").toLowerCase();
}

function words(text: string): string[] {
  return text.split(/[\s&]+/).map(bare).filter(Boolean);
}

/** True when the text has letters and none of them is lower case. */
function isAllCapitals(text: string): boolean {
  return /\p{L}/u.test(text) && text === text.toUpperCase() && text !== text.toLowerCase();
}

/**
 * Whether this pledger's public name needs a person to read it, and why.
 *
 * Returns null when there is nothing to review: the pledger is not shown
 * publicly, or a public name has already been set by hand, which means
 * somebody has already read it and decided. Otherwise returns the first rule
 * that holds, in the order the treasurer would care about them.
 */
export function nameNeedsReview(
  input: NameReviewInput,
): { reason: NameReviewReason } | null {
  if (!input.displayConsent) return null;
  if (input.publicDisplayName?.trim()) return null;

  const stored = input.storedName.trim();
  const derived = displayName(stored, { isOrganisation: input.isOrganisation });
  const derivedWords = words(derived);

  if (derivedWords.some((word) => NOT_A_NAME.has(word))) {
    return { reason: "title or word treated as a name" };
  }

  if (isAllCapitals(stored)) return { reason: "all capitals" };

  const initial = /\b([FTM])\.$/.exec(derived)?.[1];
  if (initial && words(stored).includes("family")) {
    return { reason: "surname replaced by the word Family" };
  }

  if (stored.includes("/")) return { reason: "contains a slash" };

  if (derived && !/\s/.test(derived.trim())) return { reason: "no surname" };

  return null;
}
