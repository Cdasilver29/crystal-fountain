"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  PublicPledgeDto,
  PublicPledgersPage,
} from "@/server/contracts/public-pledgers";
import { formatDateTime, formatKES, formatRelativeTime } from "@/lib/format";

/**
 * The searchable list on /pledgers.
 *
 * The first page arrives from the server, so the record is readable with
 * JavaScript switched off and the page is right on first paint. Everything
 * after that is fetched: a search replaces the list, "Load more" appends to it.
 *
 * The date rather than a relative time, because this is a record and not a
 * feed. "3 days ago" is the right answer on the home page band, where what
 * matters is that pledges are still arriving. Here what matters is when, and a
 * page somebody might scroll for a while should not quietly disagree with
 * itself about what "yesterday" means.
 */

/** Long enough that a fast typist makes one request, not eight. */
const SEARCH_DEBOUNCE_MS = 300;

/** Matches MIN_SEARCH_LENGTH in the contract. Below it, the search is cleared. */
const MIN_SEARCH_LENGTH = 2;

/** Newer than this reads as "3 hours ago"; older gets the full timestamp. */
const RELATIVE_WINDOW_MS = 48 * 60 * 60 * 1000;

type Props = {
  initial: PublicPledgeDto[];
  initialCursor: string | null;
  /**
   * When the server rendered the page. Relative times are worked out against
   * this rather than the browser's clock, so the server and the first client
   * render agree and hydration does not trip on "2 hours ago".
   */
  renderedAt: string;
};

export function PledgersList({ initial, initialCursor, renderedAt }: Props) {
  const now = new Date(renderedAt);
  const [entries, setEntries] = useState(initial);
  const [cursor, setCursor] = useState(initialCursor);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);

  const moreButton = useRef<HTMLButtonElement>(null);

  /**
   * Which search the newest response belongs to.
   *
   * Two requests in flight can come back in either order, and without this a
   * slow response for "gr" could land after the fast one for "grace" and put
   * the wrong list on screen. Every response checks that it is still the one
   * being waited for before it renders.
   */
  const latest = useRef(0);

  const fetchPage = useCallback(
    async (args: { q: string; cursor: string | null }) => {
      const params = new URLSearchParams();
      if (args.q.length >= MIN_SEARCH_LENGTH) params.set("q", args.q);
      if (args.cursor) params.set("cursor", args.cursor);

      const response = await fetch(`/api/pledges/public?${params}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(String(response.status));
      return (await response.json()) as PublicPledgersPage;
    },
    [],
  );

  // The search. Debounced, and the first render is skipped so landing on the
  // page does not immediately re-fetch the list the server already sent.
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }

    const ticket = ++latest.current;
    const trimmed = query.trim();

    setSearching(true);
    setFailed(false);

    const timer = setTimeout(async () => {
      try {
        const page = await fetchPage({ q: trimmed, cursor: null });
        if (ticket !== latest.current) return;
        setEntries(page.entries);
        setCursor(page.nextCursor);
      } catch {
        if (ticket !== latest.current) return;
        setFailed(true);
      } finally {
        if (ticket === latest.current) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, fetchPage]);

  async function loadMore() {
    if (!cursor || loadingMore) return;

    setLoadingMore(true);
    setFailed(false);

    try {
      const page = await fetchPage({ q: query.trim(), cursor });
      /*
       * Appended, never replaced, and nothing above the new rows changes size.
       * The browser keeps the scroll position on its own as long as the list
       * only grows downward, so there is no scroll restoration here to get
       * wrong.
       *
       * preventScroll is not a detail. focus() scrolls its element into view by
       * default, and since the button has just been pushed down by fifty new
       * rows, restoring focus without it threw the page 1,451 pixels down the
       * list and dropped the reader somewhere they had not been.
       */
      setEntries((current) => [...current, ...page.entries]);
      setCursor(page.nextCursor);
      requestAnimationFrame(() =>
        moreButton.current?.focus({ preventScroll: true }),
      );
    } catch {
      setFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }

  const tooShort =
    query.trim().length > 0 && query.trim().length < MIN_SEARCH_LENGTH;

  return (
    // One column across the page's full 1200px. People come here to find their
    // own name among fifty, and a single column scans top to bottom. The
    // search keeps the 640px form measure, on the same left edge as the names.
    <div>
      <div className="container-form relative mx-0">
        <label htmlFor="pledger-search" className="sr-only">
          Search pledgers by first name
        </label>
        <input
          id="pledger-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by first name"
          autoComplete="off"
          className="h-12 w-full rounded-lg border border-neutral-300 bg-white px-4 text-base text-navy placeholder:text-neutral-400 focus-visible:border-campfire focus-visible:ring-2 focus-visible:ring-campfire/30 focus-visible:outline-none"
        />
      </div>

      <p className="mt-2 min-h-5 text-sm text-neutral-500" aria-live="polite">
        {tooShort
          ? "Type at least two letters."
          : searching
            ? "Searching..."
            : query.trim()
              ? `${entries.length}${cursor ? "+" : ""} matching ${entries.length === 1 ? "pledge" : "pledges"}`
              : ""}
      </p>

      {failed ? (
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          That did not load. Check your connection and try again.
        </p>
      ) : null}

      {entries.length === 0 && !searching ? (
        <p className="mt-8 text-base text-neutral-600">
          {query.trim()
            ? "No pledges match that name. Only members who gave permission appear here, so a pledge may have been recorded without being listed."
            : "No pledges are listed yet."}
        </p>
      ) : (
        // A hairline between rows rather than alternating tint: at fifty rows
        // tint bands pull the eye along the band, while a divider keeps each
        // name and amount reading as one entry.
        //
        // From 640px the rows share one grid through subgrid: the name takes
        // the free width and the amount sits in a fixed 200px column at the
        // right, so the list spans the page and every amount lands on the same
        // vertical line.
        <ul className="mt-6 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 divide-y divide-neutral-200 border-y border-neutral-200 sm:grid-cols-[minmax(0,1fr)_200px] sm:gap-x-8">
          {entries.map((entry, index) => (
            <li
              // The list is append only and a pledge can repeat a name, an
              // amount and a date, so position is the only stable key here.
              key={`${entry.createdAt}-${index}`}
              className="col-span-full grid grid-cols-subgrid items-baseline py-4 sm:py-5"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-navy">
                  {entry.displayName}
                </p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {now.getTime() - new Date(entry.createdAt).getTime() <
                  RELATIVE_WINDOW_MS ? (
                    <time
                      dateTime={entry.createdAt}
                      title={formatDateTime(entry.createdAt)}
                    >
                      {formatRelativeTime(entry.createdAt, now)}
                    </time>
                  ) : (
                    <time dateTime={entry.createdAt}>
                      {formatDateTime(entry.createdAt)}
                    </time>
                  )}
                </p>
              </div>

              <p className="tabular text-right font-semibold whitespace-nowrap text-campfire">
                {formatKES(entry.amountMinor)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {cursor ? (
        <div className="mt-8 flex justify-center">
          <button
            ref={moreButton}
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="btn-secondary inline-flex h-12 items-center justify-center border border-neutral-300 px-8 text-base font-medium text-navy disabled:opacity-60"
          >
            {loadingMore ? "Loading..." : "Load more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
