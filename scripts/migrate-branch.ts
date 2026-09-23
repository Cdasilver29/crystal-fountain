import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { neon } from "@neondatabase/serverless";
import { parse } from "dotenv";

/**
 * pnpm db:migrate:branch
 *
 * Applies the migrations to a Neon branch for verification, and to nothing
 * else. Production is still `pnpm db:migrate`, run by the user.
 *
 * The target is BRANCH_DATABASE_URL, from the process environment or from the
 * gitignored branch.env.local. Neither file is loaded into process.env: both are
 * parsed as data, so .env.local's DATABASE_URL cannot leak into the command
 * that migrates. The Neon URL's `&` is also why nothing here is sourced by a
 * shell; see CLAUDE.md.
 *
 * Four refusals before anything is written:
 *
 * 1. No branch URL at all.
 * 2. No .env.local DATABASE_URL to compare against, because then nothing proves
 *    the target is not production.
 * 3. The branch URL resolves to the same Neon endpoint as .env.local. Compared
 *    by endpoint, not by string, so the pooled and direct hosts of one database
 *    ("ep-x-pooler.region" and "ep-x.region") are caught as the same thing.
 * 4. A sentinel written through the branch URL is visible through .env.local's
 *    URL, which would mean both reach one database whatever the hosts say.
 *
 * After migrating it reads the migration count on both again, and fails loudly
 * if production's moved.
 */

const SENTINEL_TABLE = "_migrate_branch_sentinel";

function fail(message: string): never {
  console.error(`\nrefused: ${message}\n`);
  process.exit(1);
}

function readEnvFile(path: string): Record<string, string> {
  return existsSync(path) ? parse(readFileSync(path)) : {};
}

type Target = { host: string; endpoint: string; database: string };

/**
 * The Neon endpoint a URL reaches.
 *
 * The first label of the host with any "-pooler" suffix taken off is the
 * endpoint id, which is what identifies the compute and so the branch. The rest
 * of the host is the region, kept so two regions cannot collide.
 */
function resolve(url: string, label: string): Target {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail(`${label} is not a valid connection string.`);
  }
  const host = parsed.hostname.toLowerCase();
  const [first, ...rest] = host.split(".");
  const endpoint = [first.replace(/-pooler$/, ""), ...rest].join(".");
  return { host, endpoint, database: parsed.pathname.replace(/^\//, "") };
}

async function migrationCount(url: string): Promise<number> {
  const rows = await neon(url).query(
    `select count(*)::int as n from drizzle.__drizzle_migrations`,
  );
  return (rows[0] as { n: number }).n;
}

async function main() {
  const branchUrl =
    process.env.BRANCH_DATABASE_URL?.trim() ||
    readEnvFile("branch.env.local").BRANCH_DATABASE_URL?.trim();

  if (!branchUrl) {
    fail(
      "BRANCH_DATABASE_URL is not set. Put it in the environment or in " +
        "branch.env.local (gitignored). Production migrations are pnpm db:migrate, " +
        "run by the user.",
    );
  }

  const liveUrl = readEnvFile(".env.local").DATABASE_URL?.trim();

  if (!liveUrl) {
    fail(
      "no DATABASE_URL in .env.local to compare against, so there is no way to " +
        "prove the branch is not production.",
    );
  }

  const branch = resolve(branchUrl, "BRANCH_DATABASE_URL");
  const live = resolve(liveUrl, ".env.local DATABASE_URL");

  if (branch.endpoint === live.endpoint) {
    fail(
      `BRANCH_DATABASE_URL resolves to ${branch.endpoint}, the same Neon endpoint ` +
        "as DATABASE_URL in .env.local. That is the production database.",
    );
  }

  console.log(`target host:     ${branch.host}`);
  console.log(`target database: ${branch.database}`);
  console.log(`not production:  ${live.endpoint}`);

  /*
   * The sentinel. Written through the branch URL, read back through a fresh
   * handle on the same URL, then looked for through the production URL, where
   * it must not be. Reading production is the only thing done to it.
   */
  const token = randomUUID();
  const onBranch = neon(branchUrl);
  await onBranch.query(
    `create table if not exists ${SENTINEL_TABLE} (token text primary key, at timestamptz not null default now())`,
  );
  await onBranch.query(`insert into ${SENTINEL_TABLE} (token) values ($1)`, [token]);

  const readBack = await neon(branchUrl).query(
    `select count(*)::int as n from ${SENTINEL_TABLE} where token = $1`,
    [token],
  );
  if ((readBack[0] as { n: number }).n !== 1) {
    fail("the sentinel written to the branch could not be read back from it.");
  }

  const onLive = await neon(liveUrl).query(
    `select to_regclass($1) is not null as has_table`,
    [SENTINEL_TABLE],
  );
  if ((onLive[0] as { has_table: boolean }).has_table) {
    const seen = await neon(liveUrl).query(
      `select count(*)::int as n from ${SENTINEL_TABLE} where token = $1`,
      [token],
    );
    if ((seen[0] as { n: number }).n > 0) {
      fail(
        "the sentinel written through BRANCH_DATABASE_URL is visible through " +
          ".env.local's DATABASE_URL. Both reach the same database.",
      );
    }
  }
  console.log(`sentinel:        ${token} on the branch, absent from production`);

  const before = {
    branch: await migrationCount(branchUrl),
    live: await migrationCount(liveUrl),
  };
  console.log(
    `migrations:      branch ${before.branch}, production ${before.live}\n`,
  );

  /*
   * drizzle-kit, exactly as db:migrate runs it, with DATABASE_URL set to the
   * branch in the child's environment only. drizzle.config.ts loads .env.local
   * without override, so this value is the one it uses. Node and the kit's own
   * bin rather than "pnpm exec": spawning a .cmd on Windows needs shell: true,
   * which concatenates arguments unescaped.
   */
  const result = spawnSync(
    process.execPath,
    [join(process.cwd(), "node_modules", "drizzle-kit", "bin.cjs"), "migrate"],
    {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: branchUrl },
    },
  );

  const after = {
    branch: await migrationCount(branchUrl),
    live: await migrationCount(liveUrl),
  };
  console.log(
    `\nmigrations:      branch ${after.branch}, production ${after.live}`,
  );

  if (after.live !== before.live) {
    console.error(
      "\nPRODUCTION'S MIGRATION COUNT CHANGED. Stop and tell the user.\n",
    );
    process.exit(2);
  }

  if (result.status !== 0) {
    console.error(`\ndrizzle-kit migrate exited ${result.status}`);
    process.exit(result.status ?? 1);
  }

  console.log("branch migrated; production untouched");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
