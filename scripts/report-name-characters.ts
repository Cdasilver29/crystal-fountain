import { config } from "dotenv";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Read only: which stored names carry characters cleanName would strip.
 *
 * Session 2C cleans names in the shared contract from now on and changes no
 * existing row. This says what is already stored that the cleaning would
 * have caught, so somebody can decide whether to correct any by hand.
 *
 * Selects only. Prints the pledge reference, the column and the code points
 * found, never the name itself. Also counts names that would change only by
 * NFC composition or whitespace collapsing, which are not stripped
 * characters but would not compare equal after cleaning.
 *
 * Usage: pnpm db:report:names, against whatever DATABASE_URL points at.
 */

const STRIPPABLE = /[\p{Cc}\u200B-\u200D\u2060\u180E\uFEFF\u202A-\u202E\u2066-\u2069]/gu;

function codePoints(value: string): string {
  const found = [...new Set(value.match(STRIPPABLE) ?? [])];
  return found
    .map((ch) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`)
    .join(" ");
}

async function main() {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const { cleanName, hasStrippableCharacters } = await import("@/server/contracts/names");

  const rows = await db.execute(sql`
    select 'pledgers.full_name' as field, g.full_name as value,
           (select string_agg(p.reference, ' ' order by p.reference)
              from pledges p where p.pledger_id = g.id) as refs
      from pledgers g
    union all
    select 'pledgers.display_name', g.display_name,
           (select string_agg(p.reference, ' ' order by p.reference)
              from pledges p where p.pledger_id = g.id)
      from pledgers g where g.display_name is not null
    union all
    select 'pledgers.public_display_name', g.public_display_name,
           (select string_agg(p.reference, ' ' order by p.reference)
              from pledges p where p.pledger_id = g.id)
      from pledgers g where g.public_display_name is not null
    union all
    select 'pledge_change_requests.requested_name', r.requested_name, p.reference
      from pledge_change_requests r join pledges p on p.id = r.pledge_id
      where r.requested_name is not null
  `);

  const all = rows.rows as { field: string; value: string; refs: string | null }[];
  const stripped = all.filter((r) => hasStrippableCharacters(r.value));
  const otherwise = all.filter(
    (r) => !hasStrippableCharacters(r.value) && cleanName(r.value) !== r.value,
  );

  console.log(`names read: ${all.length}`);
  console.log(`carrying characters the cleaning strips: ${stripped.length}`);
  if (stripped.length > 0) {
    console.table(
      stripped.map((r) => ({
        field: r.field,
        references: r.refs ?? "(none)",
        characters: codePoints(r.value),
      })),
    );
  }

  console.log(
    `changed only by NFC or whitespace, nothing stripped: ${otherwise.length}`,
  );
  if (otherwise.length > 0) {
    console.table(
      otherwise.map((r) => ({
        field: r.field,
        references: r.refs ?? "(none)",
        nfc: r.value.normalize("NFC") !== r.value,
        whitespace: /^\s|\s$|\s{2,}|[^\S ]/u.test(r.value),
      })),
    );
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
