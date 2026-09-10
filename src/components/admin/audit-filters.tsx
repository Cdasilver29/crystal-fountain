"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AUDIT_FILTERS, type AuditFilter } from "@/server/contracts/admin";

/**
 * Filtering the audit journal.
 *
 * The same shape as the pledge filters, and for the same reasons: the filters
 * live in the URL, the server does the filtering, and this only decides when
 * to change the URL. That is what lets a filtered journal be refreshed, sent
 * to somebody as a link, and paged through without losing the filter.
 *
 * The search box is debounced so typing a name is one navigation rather than
 * one per keystroke. The dropdown is not, because choosing from it is already
 * a single deliberate act.
 */

const DEBOUNCE_MS = 300;

const FILTER_LABELS: Record<AuditFilter, string> = {
  all: "All actions",
  pledges: "Pledges",
  payments: "Payments",
  auth: "Auth",
  exports: "Exports",
};

/**
 * The journal URL for a set of filters.
 *
 * The cursor is deliberately absent. It is a position in one particular
 * filtered ordering, so carrying it across a filter change would land on a row
 * that may not be in the new result set at all.
 */
function hrefFor(q: string | null, filter: AuditFilter): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (filter !== "all") params.set("filter", filter);
  const query = params.toString();
  return query ? `/admin/audit?${query}` : "/admin/audit";
}

export function AuditFilters({
  q,
  filter,
}: {
  q: string | null;
  filter: AuditFilter;
}) {
  const router = useRouter();
  const [term, setTerm] = useState(q ?? "");

  // What the URL currently says, so the debounce can tell a real edit from
  // this component being re-rendered with the value it just asked for.
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
      router.replace(hrefFor(term.trim() || null, filter));
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [term, filter, router]);

  const filtered = q !== null || filter !== "all";

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex-1">
        <label htmlFor="audit-search" className="sr-only">
          Search the journal by action or by who did it
        </label>
        <input
          id="audit-search"
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search by action or by who did it"
          className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-base text-navy focus-visible:border-campfire focus-visible:ring-2 focus-visible:ring-campfire/40 focus-visible:outline-none"
        />
      </div>

      <div>
        <label htmlFor="audit-filter" className="sr-only">
          Filter by kind of action
        </label>
        <select
          id="audit-filter"
          value={filter}
          onChange={(event) => {
            const next = event.target.value as AuditFilter;
            // The typed term goes with it, so choosing a filter does not throw
            // away a search already entered.
            committed.current = term.trim();
            router.replace(hrefFor(term.trim() || null, next));
          }}
          className="h-11 w-full cursor-pointer rounded-lg border border-neutral-300 bg-white px-3 text-base text-navy focus-visible:border-campfire focus-visible:ring-2 focus-visible:ring-campfire/40 focus-visible:outline-none sm:w-48"
        >
          {AUDIT_FILTERS.map((value) => (
            <option key={value} value={value}>
              {FILTER_LABELS[value]}
            </option>
          ))}
        </select>
      </div>

      {filtered && (
        <Link
          href="/admin/audit"
          className="rounded text-sm font-medium text-denim underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
        >
          Clear filters
        </Link>
      )}
    </div>
  );
}
