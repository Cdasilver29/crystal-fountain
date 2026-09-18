"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { SelectField } from "@/components/ui/select-field";
import {
  CHANGE_REQUEST_KINDS,
  CHANGE_REQUEST_LABELS,
  CHANGE_REQUEST_STATUSES,
} from "@/server/contracts/change-requests";

/**
 * Filtering the change request queue.
 *
 * The same shape as the audit and pledge filters, and for the same reasons:
 * the filters live in the URL, the server does the filtering, and this only
 * decides when to change the URL. That is what lets a filtered queue be
 * refreshed, sent to somebody as a link, and paged through without losing the
 * filter.
 *
 * No search box. A queue is short by construction, and there is nothing here
 * anybody would search for that the two dropdowns do not already narrow.
 */

type StatusFilter = "all" | (typeof CHANGE_REQUEST_STATUSES)[number];
type KindFilter = "all" | (typeof CHANGE_REQUEST_KINDS)[number];

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "Every status",
  pending: "Waiting",
  approved: "Approved",
  declined: "Declined",
  closed: "Closed",
};

/**
 * The queue URL for a set of filters.
 *
 * The cursor is deliberately absent. It is a position in one particular
 * filtered ordering, so carrying it across a filter change would land on a row
 * that may not be in the new result set at all.
 *
 * Pending is the default the server applies, so it is left out of the URL and
 * "all" is the one that has to be spelled.
 */
function hrefFor(status: StatusFilter, kind: KindFilter): string {
  const params = new URLSearchParams();
  if (status !== "pending") params.set("status", status);
  if (kind !== "all") params.set("kind", kind);
  const query = params.toString();
  return query ? `/admin/change-requests?${query}` : "/admin/change-requests";
}

export function ChangeRequestFilters({
  status,
  kind,
}: {
  status: StatusFilter;
  kind: KindFilter;
}) {
  const router = useRouter();
  const filtered = status !== "pending" || kind !== "all";

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div>
        <label htmlFor="request-status" className="sr-only">
          Filter by whether it has been answered
        </label>
        <SelectField
          id="request-status"
          value={status}
          onChange={(event) =>
            router.replace(hrefFor(event.target.value as StatusFilter, kind))
          }
          className="w-full sm:w-44"
        >
          {(["all", ...CHANGE_REQUEST_STATUSES] as StatusFilter[]).map(
            (value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value]}
              </option>
            ),
          )}
        </SelectField>
      </div>

      <div>
        <label htmlFor="request-kind" className="sr-only">
          Filter by what is being asked for
        </label>
        <SelectField
          id="request-kind"
          value={kind}
          onChange={(event) =>
            router.replace(hrefFor(status, event.target.value as KindFilter))
          }
          className="w-full sm:w-56"
        >
          <option value="all">Every kind</option>
          {CHANGE_REQUEST_KINDS.map((value) => (
            <option key={value} value={value}>
              {CHANGE_REQUEST_LABELS[value]}
            </option>
          ))}
        </SelectField>
      </div>

      {filtered && (
        <Link
          href="/admin/change-requests"
          className="rounded text-sm font-medium text-denim underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
        >
          Back to what is waiting
        </Link>
      )}
    </div>
  );
}
