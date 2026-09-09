"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  PLEDGE_STATUS_FILTERS,
  type PledgeStatusFilter,
} from "@/server/contracts/admin";

/**
 * Filtering the pledge list.
 *
 * The filters live in the URL and the server does the filtering. This component
 * only decides when to change the URL, which is what makes a filtered screen
 * survive a refresh, work as a shared link, and keep paginating: the cursor and
 * the filters travel together in the same query string.
 *
 * The search box is debounced so a five character reference is one navigation
 * rather than five. The status dropdown is not, because choosing from a
 * dropdown is already a deliberate single act.
 */

const DEBOUNCE_MS = 300;

const STATUS_LABELS: Record<PledgeStatusFilter, string> = {
  all: "All statuses",
  pending: "Pending",
  verified: "Verified",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
  void: "Void",
};

/**
 * The pledge list URL for a set of filters.
 *
 * Note what is missing: the cursor. Changing a filter always returns to the
 * first page, because a cursor is a position in one particular filtered
 * ordering and carrying it across would land on a row that may not be in the
 * new result set at all.
 */
function hrefFor(q: string | null, status: PledgeStatusFilter): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status !== "all") params.set("status", status);
  const query = params.toString();
  return query ? `/admin/pledges?${query}` : "/admin/pledges";
}

export function PledgeFilters({
  q,
  status,
}: {
  q: string | null;
  status: PledgeStatusFilter;
}) {
  const router = useRouter();
  const [term, setTerm] = useState(q ?? "");

  /*
   * What the URL currently says, so the debounce can tell a real edit from this
   * component being re-rendered with the values it just asked for. Without it
   * every navigation would schedule another identical one.
   */
  const committed = useRef(q ?? "");

  useEffect(() => {
    committed.current = q ?? "";
    setTerm(q ?? "");
  }, [q]);

  useEffect(() => {
    if (term === committed.current) return;

    const timer = setTimeout(() => {
      committed.current = term;
      // replace, not push, so a search does not leave one history entry per
      // pause in typing for the back button to walk through.
      router.replace(hrefFor(term.trim() || null, status));
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [term, status, router]);

  const filtered = q !== null || status !== "all";

  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex-1">
        <label htmlFor="pledge-search" className="sr-only">
          Search pledges by reference, name or phone number
        </label>
        <input
          id="pledge-search"
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search by reference, name or phone number"
          className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-base text-navy focus-visible:border-campfire focus-visible:ring-2 focus-visible:ring-campfire/40 focus-visible:outline-none"
        />
      </div>

      <div>
        <label htmlFor="pledge-status" className="sr-only">
          Filter by status
        </label>
        <select
          id="pledge-status"
          value={status}
          onChange={(event) => {
            const next = event.target.value as PledgeStatusFilter;
            // The typed term goes with it, so choosing a status does not throw
            // away a search the treasurer has already entered.
            committed.current = term.trim();
            router.replace(hrefFor(term.trim() || null, next));
          }}
          className="h-11 w-full cursor-pointer rounded-lg border border-neutral-300 bg-white px-3 text-base text-navy focus-visible:border-campfire focus-visible:ring-2 focus-visible:ring-campfire/40 focus-visible:outline-none sm:w-48"
        >
          {PLEDGE_STATUS_FILTERS.map((value) => (
            <option key={value} value={value}>
              {STATUS_LABELS[value]}
            </option>
          ))}
        </select>
      </div>

      {filtered && (
        <Link
          href="/admin/pledges"
          className="rounded text-sm font-medium text-denim underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
        >
          Clear filters
        </Link>
      )}
    </div>
  );
}
