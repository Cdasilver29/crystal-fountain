/**
 * How a pledger's name is rendered on a public page.
 *
 * One function, because the rule has to be identical on the home page band, on
 * /pledgers, and anywhere else a consented name is listed later. It used to be
 * "everything before the first space, plus the first letter of the rest", which
 * is only correct for names shaped "First Last". The congregation's real names
 * are not: "Mr. Steve Mogere" came out as "Mr. S." and the joint pledge
 * "Melanie& Vincent" came out as "Melanie& V.".
 *
 * What comes out is a given name and at most one letter of a surname. The
 * surname itself never leaves this function, so a full name has no route to a
 * public surface even if a caller is careless with what it renders.
 *
 * The awkward cases here were all taken from the live campaign rather than
 * imagined: "Dr.PAUL & CHARYL OTUNG'S FAMILY" with the title glued to the name,
 * "Mr &Mrs Abuga." where the only real word is the shared surname, "Mr/so
 * Maxuel Omondi" where the title is a mistyped "Mr/Mrs", and "Symon and Scoller
 * Otieno" joined by a word rather than a sign.
 *
 * A plain function with no database and no Next imports, next to pagination.ts,
 * so services and route handlers can both use it and the domain stays portable.
 */

/**
 * Titles stripped before the given name is picked.
 *
 * Matched case insensitively, with or without a trailing full stop. A title is
 * not a name and "Mr. S." tells nobody anything, so "Mr. Steve Mogere" has to
 * reach the page as "Steve M.".
 */
export const TITLE_WORDS: readonly string[] = [
  "mr",
  "mrs",
  "ms",
  "miss",
  "dr",
  "prof",
  "pr",
  "pastor",
  "elder",
  "eng",
  "rev",
  "sr",
  "br",
];

/**
 * The same list as a set, for the checks below.
 *
 * The array is what is exported, because the public list service builds a
 * Postgres regex from it to strip the same titles when deciding what a search
 * term may match. One list, so the name people see and the name they can search
 * for cannot drift apart.
 */
const TITLES: ReadonlySet<string> = new Set(TITLE_WORDS);

/**
 * A joint pledge, split on the first joiner.
 *
 * Both "&" and the word "and" join two people. The left side is non greedy so
 * only the first joiner splits, and "and" is bounded so it cannot fire inside
 * Alexander or Sandra. Spaces around the joiner are optional, which is what
 * rescues the "Melanie& Vincent" already in the database.
 */
const JOINT = /^(.*?)\s*(?:&|\band\b)\s*(.+)$/i;

/**
 * A title written straight onto the name, as in "Dr.PAUL".
 *
 * Without this the title is never recognised, because it is not a word of its
 * own, and the whole thing survives to the page as "Dr.PAUL".
 */
const GLUED_TITLE = new RegExp(
  `\\b(${[...TITLES].join("|")})\\.(?=\\p{L})`,
  "giu",
);

/** Trim, collapse runs of whitespace, and unstick any glued title. */
function normalise(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").replace(GLUED_TITLE, "$1. ").trim();
}

/**
 * Whether a word is a title rather than a name.
 *
 * A trailing full stop is ignored, and a word joined by slashes counts when its
 * first part is a title, which is what catches the mistyped "Mr/so". "AMM/AMO"
 * does not match, because "amm" is not a title, so an organisation keeps its
 * name.
 */
function isTitle(word: string): boolean {
  const bare = word.toLowerCase().replace(/\.$/, "");
  if (TITLES.has(bare)) return true;
  const [first, ...rest] = bare.split("/");
  return rest.length > 0 && TITLES.has(first);
}

/** Drops leading titles. Returns an empty array if that is all there was. */
function stripTitles(words: readonly string[]): string[] {
  let start = 0;
  while (start < words.length && isTitle(words[start])) start += 1;
  return words.slice(start);
}

/** First letter upper cased, the rest of the word left exactly as typed. */
function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * The surname's initial, as one upper case letter and a full stop.
 *
 * Leading punctuation is skipped and anything after the first letter is
 * dropped, so "Kamau", "kamau," and "(Kamau)" all give "K." and a word with no
 * letter in it at all, such as a stray "&", gives nothing rather than putting
 * punctuation where an initial belongs.
 */
function initialOf(word: string): string | null {
  const letter = word.replace(/^[^\p{L}]+/u, "").charAt(0);
  return letter ? `${letter.toUpperCase()}.` : null;
}

/** A name reduced to the given name shown and the surname behind the initial. */
type Parsed = { given: string; surname: string | null };

/**
 * Splits one person's name into what is shown and what becomes an initial.
 *
 * `singleWordIsGiven` decides the one genuinely ambiguous shape, a title
 * followed by a single word:
 *
 *   "Mrs Abuga." in "Mr &Mrs Abuga."   -> Abuga is the shared surname
 *   "Dr. PAUL"   in "Dr.PAUL & CHARYL" -> PAUL is a given name
 *
 * Nothing inside the string separates them, so position does. Only the first
 * person in a joint pledge gets the benefit of the doubt, because the surname
 * in that shape sits at the far end of the string and cannot also be sitting
 * here. Everywhere else the word is treated as a surname, since publishing a
 * bare surname is the failure that matters and "Mrs O." costs a given name at
 * worst.
 */
function parse(part: string, singleWordIsGiven: boolean): Parsed {
  const words = part.split(" ").filter(Boolean);
  if (words.length === 0) return { given: "", surname: null };

  const stripped = stripTitles(words);
  const hadTitle = stripped.length < words.length;

  // Nothing but a title, so it stands in as the name: "Pastor" stays "Pastor".
  if (stripped.length === 0) return { given: words[0], surname: null };

  if (stripped.length === 1) {
    // A title and one word. See the note above on which way this goes.
    if (hadTitle && !singleWordIsGiven) {
      return { given: words[0], surname: stripped[0] };
    }
    return { given: stripped[0], surname: null };
  }

  // The last word, not the second: a middle name is not a surname, so
  // "Grace Wanjiru Kamau" is Grace K. rather than Grace W.
  return { given: stripped[0], surname: stripped[stripped.length - 1] };
}

/** Assembles a parsed name, with the initial only when there is a surname. */
function render({ given, surname }: Parsed): string {
  const initial = surname ? initialOf(surname) : null;
  return initial ? `${capitalise(given)} ${initial}` : capitalise(given);
}

/**
 * Renders a stored display name for public listing.
 *
 * "Grace Kamau"             -> "Grace K."
 * "Grace Wanjiru Kamau"     -> "Grace K."     (a middle name is not a surname)
 * "Mr. Steve Mogere"        -> "Steve M."
 * "Melanie & Victor Otieno" -> "Melanie & Victor O."
 * "Grace"                   -> "Grace"
 *
 * Returns an empty string for an empty name. The feed query already refuses
 * rows whose display name is blank, so this is a guard rather than a case any
 * caller is expected to render.
 */
export function displayName(raw: string): string {
  const cleaned = normalise(raw);
  if (!cleaned) return "";

  const joint = JOINT.exec(cleaned);

  /*
   * A joint pledge keeps both given names and shares one initial, because the
   * surname at the end of the string belongs to both: "Melanie & Victor O.".
   *
   * Each side is reduced to its own first word before being joined, so a name
   * written "Melanie Wanjiru & Victor Otieno" cannot publish "Wanjiru" on its
   * way past. The joiner is always rendered as a spaced ampersand, whichever
   * form was typed, so the column reads the same all the way down.
   */
  if (joint && joint[1].trim() && joint[2].trim()) {
    const left = parse(joint[1].trim(), true);
    const right = parse(joint[2].trim(), false);

    if (left.given && right.given) {
      const names = `${capitalise(left.given)} & ${capitalise(right.given)}`;

      /*
       * The initial comes from the very end of the whole string, which is where
       * a shared surname sits, and only when the second person has more than a
       * given name there. "Melanie & Vincent" must not become
       * "Melanie & Vincent V.".
       */
      const initial = right.surname ? initialOf(right.surname) : null;
      return initial ? `${names} ${initial}` : names;
    }
  }

  const parsed = parse(cleaned, false);
  return parsed.given ? render(parsed) : cleaned;
}
