import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

/**
 * Runs scripts/verify.sql against the configured database.
 *
 * scripts/verify.sql is the canonical artifact and is written for psql. This
 * runner exists because the development machine has no psql on PATH. It reads
 * the same file, treats each \echo line as a section heading and runs the SQL
 * between headings, so there is one source of truth for the queries.
 */

config({ path: ".env.local" });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
  );
}

const sqlFile = process.argv[2] ?? "scripts/verify.sql";

type Block = { heading: string | null; statement: string };

function parse(source: string): Block[] {
  const blocks: Block[] = [];
  let heading: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const statement = buffer.join("\n").trim();
    if (statement) blocks.push({ heading, statement });
    buffer = [];
  };

  for (const line of source.split(/\r?\n/)) {
    const echo = line.match(/^\\echo\s+'(.*)'\s*$/);
    if (echo) {
      flush();
      const text = echo[1].trim();
      if (text) heading = text;
      continue;
    }
    if (line.startsWith("\\")) continue;
    if (line.trim().startsWith("--")) continue;
    buffer.push(line);
  }
  flush();

  return blocks;
}

// bigint columns arrive as strings from the driver, which is what we want for
// display. Never coerce a money value to a JavaScript number.
function render(rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    console.log("(0 rows)");
    return;
  }
  console.table(
    rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          value === null ? null : String(value),
        ]),
      ),
    ),
  );
}

async function main() {
  const sql = neon(databaseUrl!);
  const blocks = parse(readFileSync(sqlFile, "utf8"));

  for (const block of blocks) {
    if (block.heading) console.log(`\n${block.heading}`);
    const rows = (await sql.query(
      block.statement.replace(/;\s*$/, ""),
    )) as Record<string, unknown>[];
    render(rows);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
