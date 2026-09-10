import { z } from "zod";

/**
 * Cursor pagination.
 *
 * PLAN.md section 13: cursor pagination everywhere, because offset pagination
 * breaks when rows are inserted during paging, which is exactly what happens on
 * a live campaign. A treasurer reading page two while three payments arrive
 * would see rows shift backwards past the boundary and miss some entirely.
 *
 * A cursor is a keyset, not a position. It carries the sort key of the last row
 * on the page and that row's id, and the next page asks for everything strictly
 * after that pair. Ties on the key are broken by the id, so the ordering is
 * total and no row can sit on a boundary ambiguously.
 *
 * It is opaque to the client but it is not a secret and it is not signed. It
 * encodes a timestamp and a uuid the caller has already been shown, so there is
 * nothing in it to protect. Tampering can only produce a different window over
 * rows the caller is already authorised to read, or a cursor that fails to
 * decode and is treated as absent.
 *
 * Plain functions with no database and no Next imports, so services and route
 * handlers can both use them.
 */

export type Cursor = {
  /** The sort key of the last row on the page, as an ISO 8601 timestamp. */
  key: string;
  /** That row's id, breaking ties on the key. */
  id: string;
};

/*
 * The tie breaker is a uuid on every table but one. audit_log is keyed by a
 * bigserial, because it is an append only journal where the insertion order is
 * itself the thing being recorded, so a numeric id is accepted here too.
 *
 * Both forms are compared as opaque values in a keyset expression against a
 * column of a known type, so a numeric cursor handed to a uuid keyed screen
 * simply matches nothing. It cannot widen what a caller can read.
 */
const cursorShape = z.object({
  k: z.iso.datetime({ offset: true }),
  i: z.union([z.uuid(), z.string().regex(/^\d{1,19}$/)]),
});

/**
 * base64url, so a cursor survives a query string untouched.
 *
 * Plain base64 would put "+" and "/" in the URL, and "+" decodes back as a
 * space. Node has had base64url built in since 14, so this is one call rather
 * than a replace chain.
 */
export function encodeCursor(cursor: Cursor): string {
  const payload = JSON.stringify({ k: cursor.key, i: cursor.id });
  return Buffer.from(payload, "utf8").toString("base64url");
}

/**
 * Decodes a cursor, or returns null.
 *
 * Null for anything malformed rather than a throw. A stale or hand edited
 * cursor in a bookmarked URL should quietly show the first page, not a 500. The
 * shape is validated because these two values go into a SQL comparison, and an
 * unparsed date or a non uuid has no business getting that far.
 */
export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;

  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = cursorShape.safeParse(JSON.parse(decoded));
    if (!parsed.success) return null;
    return { key: parsed.data.k, id: parsed.data.i };
  } catch {
    return null;
  }
}

/** One page of rows, and the cursor that reaches the next one. */
export type Page<T> = {
  items: T[];
  /** Null when this is the last page. */
  nextCursor: string | null;
  hasMore: boolean;
};

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/** Clamps a requested page size into something a query may be handed. */
export function pageSize(requested?: number): number {
  if (!requested || !Number.isInteger(requested) || requested < 1) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(requested, MAX_PAGE_SIZE);
}

/**
 * Turns an over-fetched result set into a page.
 *
 * The caller queries limit + 1 rows. If the extra one came back there is
 * another page, and it is dropped rather than shown. That is one query rather
 * than a second count query, and unlike a count it cannot disagree with the
 * rows it describes.
 */
export function toPage<T>(
  rows: T[],
  limit: number,
  cursorOf: (row: T) => Cursor,
): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];

  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(cursorOf(last)) : null,
    hasMore,
  };
}

/** The query string a paginated screen or endpoint accepts. */
export const pageParams = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
});

export type PageParams = z.infer<typeof pageParams>;
