import { z } from "zod";

import { MAX_PAGE_SIZE } from "@/server/pagination";

/**
 * What GET /api/pledges/public accepts.
 *
 * The one public list endpoint on the site, so the contract is deliberately
 * small: a cursor and a search term, and nothing that could widen what comes
 * back. There is no campaign parameter, no status parameter and no way to ask
 * for a field: the service decides all three, and a caller cannot talk it into
 * returning a pledge nobody consented to publish.
 */

/**
 * How many rows a page holds.
 *
 * Fifty is what the page asks for and what it gets. The cap exists because the
 * limit crosses the wire and a caller could otherwise ask for the whole list in
 * one request, which is the thing the rate limit is there to slow down.
 */
export const PUBLIC_PAGE_SIZE = 50;

/**
 * The shortest search that runs.
 *
 * A single letter matches a large share of the congregation and tells the
 * person searching nothing, so it is treated as no search at all rather than as
 * a filter that happens to return most of the page.
 */
export const MIN_SEARCH_LENGTH = 2;

export const publicPledgersQuery = z.object({
  /*
   * Opaque, and validated properly by decodeCursor rather than here. A stale
   * cursor from a bookmarked URL should quietly show the first page, so the
   * only job at this layer is to refuse one long enough to be an attack on the
   * decoder.
   */
  cursor: z.string().max(512).optional(),

  /*
   * The search box. Trimmed, capped, and matched against the pledger's given
   * name only, which the service enforces: searching a surname must not be a
   * way to confirm whether a particular person pledged.
   */
  q: z.string().trim().max(60).optional(),

  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
});

export type PublicPledgersQuery = z.infer<typeof publicPledgersQuery>;

/**
 * One row as it crosses to the client.
 *
 * Three fields, and this type is the reason there are three. No reference, no
 * public token, no id, no phone number, no email address and no surname. The id
 * is left out on purpose as well: it is the pledge's primary key, and a public
 * page has no use for it that is worth handing out a database identifier for.
 */
export type PublicPledgeDto = {
  displayName: string;
  amountMinor: string;
  createdAt: string;
};

/** A page of the public list, as the endpoint returns it. */
export type PublicPledgersPage = {
  entries: PublicPledgeDto[];
  /** Null when this is the last page. */
  nextCursor: string | null;
};
