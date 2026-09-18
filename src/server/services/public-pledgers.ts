import { sql } from "drizzle-orm";

import type { Db } from "@/db";
import {
  PUBLIC_PAGE_SIZE,
  MIN_SEARCH_LENGTH,
  type PublicPledgeDto,
} from "@/server/contracts/public-pledgers";
import { TITLE_WORDS, displayName } from "@/server/display-name";
import { tooManyRequests } from "@/server/errors";
import {
  type Page,
  decodeCursor,
  pageSize,
  toPage,
} from "@/server/pagination";
import { escapeLike } from "@/server/sql";

/**
 * The public list of pledgers behind /pledgers.
 *
 * The drifting band on the home page is atmosphere. This is the record: every
 * pledge whose pledger ticked the box that says a name may appear publicly,
 * newest first, searchable so that somebody can type their own name and find
 * themselves.
 *
 * Consent decides who is here and nothing else does. The filter is the same one
 * the home page feed uses and the same status set v_campaign_totals counts, so
 * the list, the band and the figure at the top of the site can never disagree
 * about which pledges exist.
 *
 * What leaves this file is a rendered name, an amount and a date. No reference,
 * no public token, no pledge id, no phone number, no email address and no
 * surname. The columns are not selected, so there is nothing for a careless
 * caller to pass on.
 */

/** How many requests one address may make to the public list in the window. */
export const PUBLIC_LIST_RATE_LIMIT = 30;

/** The window that limit is counted over. */
export const PUBLIC_LIST_RATE_WINDOW_SECONDS = 60;

type PublicRow = {
  id: string;
  display_name: string;
  amount_minor: string;
  created_at: string;
};

/**
 * Strips a leading title inside Postgres, so a search matches the name shown.
 *
 * "Mr. Steve Mogere" appears on the page as "Steve M.", so typing "Steve" has
 * to find it. Matching the raw first word would search for "Mr." instead and
 * find nothing, which on a page whose whole purpose is finding yourself is the
 * one failure that matters.
 *
 * Built from the same list display-name.ts renders with, rather than a second
 * copy written out here, so the two cannot drift.
 *
 * The optional slashed tail matches the mistyped "Mr/so" that is already in the
 * database, the same way the renderer does. Without it the member shown as
 * "Maxuel O." could not be found by typing Maxuel, which on this page is the
 * whole failure. Longest titles first, so "mrs" is preferred over "mr".
 */
const TITLE_PREFIX = `^(?:${[...TITLE_WORDS]
  .sort((a, b) => b.length - a.length)
  .join("|")})(?:/[a-z]+)?\\.?\\s+`;

/**
 * The name a search term is matched against: the given name, and only that.
 *
 * This is the privacy rule of the whole endpoint. A surname is never compared
 * against, so searching "Otieno" returns nothing and cannot be used to confirm
 * whether a particular family pledged. The column still holds the full name,
 * and this expression is the only thing the search ever sees of it.
 */
const SEARCHABLE_GIVEN_NAME = sql`
  split_part(
    trim(regexp_replace(trim(g.display_name), ${TITLE_PREFIX}, '', 'i')),
    ' ',
    1
  )
`;

/**
 * The rows that may appear publicly at all.
 *
 * One definition, used by both the list and the counts below, so the number at
 * the top of the page and the rows underneath it are answers to the same
 * question.
 */
function consentedClause(campaignSlug: string) {
  return sql`
    c.slug = ${campaignSlug}
    and p.deleted_at is null
    and p.status in ('verified', 'fulfilled')
    and g.display_consent = true
    and g.display_name is not null
    and length(trim(g.display_name)) > 0
  `;
}

/**
 * Counts the limiter's window and records this request.
 *
 * Read then write, so a caller's own request does not count against them, and
 * the write happens whatever the outcome: a limiter that stopped recording once
 * the limit was hit would let an address back in a minute later no matter how
 * hard it had been pushing.
 */
async function rateLimit(db: Db, ip: string | null): Promise<void> {
  /*
   * Counted and recorded in one statement.
   *
   * Two round trips to Neon before the list query had even started put a search
   * at about 1.4 seconds, on the one page whose whole purpose is typing a name
   * and seeing it. The CTE reads the window and writes this request together,
   * and because the select in a CTE sees the table as it was at the start of
   * the statement, the count still excludes the row being inserted beside it.
   */
  const recent = await db.execute(sql`
    with window_count as (
      select count(*)::int as requests
      from public_list_requests
      where at > now() - make_interval(secs => ${PUBLIC_LIST_RATE_WINDOW_SECONDS})
        and ip is not distinct from ${ip}::inet
    ),
    recorded as (
      insert into public_list_requests (ip) values (${ip}::inet)
      returning 1
    )
    select requests from window_count, recorded
  `);

  if ((recent.rows[0] as { requests: number }).requests >= PUBLIC_LIST_RATE_LIMIT) {
    throw tooManyRequests(
      "public_list_rate_limited",
      "Too many requests from this connection. Please wait a minute and try again.",
    );
  }
}

/**
 * The search term, reduced to the one word that may be matched.
 *
 * Only the first word, so somebody who types their full name still finds
 * themselves while the surname half of what they typed is discarded rather than
 * searched for. Anything shorter than two characters is treated as no search:
 * a single letter matches much of the congregation and answers nothing.
 */
function searchTerm(raw: string | null | undefined): string | null {
  const first = raw?.trim().split(/\s+/)[0] ?? "";
  return first.length >= MIN_SEARCH_LENGTH ? first : null;
}

export type PublicListArgs = {
  campaignSlug: string;
  cursor?: string | null;
  q?: string | null;
  limit?: number;
  /** The caller's address, for the rate limit. Null when it is unreadable. */
  request?: { ip: string | null };
};

/** One page of the public list, newest first. */
export async function publicList(
  db: Db,
  args: PublicListArgs,
): Promise<Page<PublicPledgeDto>> {
  if (args.request) await rateLimit(db, args.request.ip);

  const limit = pageSize(args.limit ?? PUBLIC_PAGE_SIZE);
  const cursor = decodeCursor(args.cursor);
  const term = searchTerm(args.q);

  const searchClause =
    term === null
      ? sql`true`
      : sql`${SEARCHABLE_GIVEN_NAME} ilike ${`%${escapeLike(term)}%`} escape '\\'`;

  /*
   * (created_at, id) < (k, i) compares the pair lexicographically in one
   * indexable expression, so a pledge recorded in the same second as another
   * still sits on exactly one side of the page boundary.
   */
  const cursorClause =
    cursor === null
      ? sql`true`
      : sql`(p.created_at, p.id) < (${cursor.key}::timestamptz, ${cursor.id}::uuid)`;

  const result = await db.execute(sql`
    select p.id::text as id,
           g.display_name,
           p.amount_minor,
           p.created_at
    from pledges p
    join pledgers g on g.id = p.pledger_id
    join campaigns c on c.id = p.campaign_id
    where ${consentedClause(args.campaignSlug)}
      and ${searchClause}
      and ${cursorClause}
    order by p.created_at desc, p.id desc
    limit ${limit + 1}
  `);

  /*
   * The id is carried this far only to build the cursor, and is dropped on the
   * way out. A keyset needs a tie breaker; a public page does not need a
   * database identifier for every pledge on it.
   */
  const rows = (result.rows as PublicRow[]).map((row) => ({
    id: row.id,
    createdAt: new Date(row.created_at),
    entry: {
      displayName: displayName(row.display_name),
      amountMinor: BigInt(row.amount_minor).toString(),
      createdAt: new Date(row.created_at).toISOString(),
    } satisfies PublicPledgeDto,
  }));

  const page = toPage(rows, limit, (row) => ({
    key: row.createdAt.toISOString(),
    id: row.id,
  }));

  return {
    items: page.items.map((row) => row.entry),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  };
}

/** The two figures at the top of the page. */
export type PublicCounts = {
  /** Every pledge that counts toward the campaign, consented or not. */
  recorded: number;
  /** How many of those may be listed here. */
  shown: number;
};

/**
 * The counts, read in one query so they cannot disagree.
 *
 * Both are needed because the gap between them is the honest part of the page.
 * A list of 180 names under a campaign that has recorded 412 pledges invites
 * exactly one question, and the page answers it in a line rather than leaving
 * the congregation to wonder whose pledges are missing.
 */
export async function publicCounts(
  db: Db,
  args: { campaignSlug: string },
): Promise<PublicCounts> {
  const result = await db.execute(sql`
    select count(*)::int as recorded,
           count(*) filter (
             where g.display_consent = true
               and g.display_name is not null
               and length(trim(g.display_name)) > 0
           )::int as shown
    from pledges p
    join pledgers g on g.id = p.pledger_id
    join campaigns c on c.id = p.campaign_id
    where c.slug = ${args.campaignSlug}
      and p.deleted_at is null
      and p.status in ('verified', 'fulfilled')
  `);

  const row = result.rows[0] as { recorded: number; shown: number };
  return { recorded: row.recorded, shown: row.shown };
}
