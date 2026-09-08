"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { formatDate, formatKes } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The treasurer's pledge list.
 *
 * Two renderings of the same data: stacked cards on a phone, a table from the
 * small breakpoint up. A 36rem wide table cannot be read on a 360px screen, and
 * the treasurer is as likely to approve pledges on a phone after a service as
 * at a desk.
 *
 * Amounts arrive as minor unit strings and stay strings. Nothing here turns a
 * money value into a JavaScript number.
 */

export type AdminPledgeDto = {
  id: string;
  reference: string;
  fullName: string;
  amountMinor: string;
  status: string;
  createdAt: string;
};

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-900",
  verified: "bg-emerald-100 text-emerald-900",
  fulfilled: "bg-emerald-100 text-emerald-900",
  cancelled: "bg-neutral-200 text-neutral-700",
  void: "bg-neutral-200 text-neutral-700",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-block rounded-full px-2.5 py-1 text-xs font-medium",
        STATUS_STYLES[status] ?? "bg-neutral-200 text-neutral-700",
      )}
    >
      {status}
    </span>
  );
}

export function PledgeTable({ rows }: { rows: AdminPledgeDto[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function approve(row: AdminPledgeDto) {
    setBusyId(row.id);
    setError(null);

    try {
      const response = await fetch(`/api/admin/pledges/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.title ?? `Could not approve ${row.reference}.`);
        setBusyId(null);
        return;
      }

      // The route handler has already invalidated the campaign totals tag, so
      // refreshing picks up both the new status and the new public figure.
      startTransition(() => {
        router.refresh();
        setBusyId(null);
      });
    } catch {
      setError("Could not reach the server.");
      setBusyId(null);
    }
  }

  function ApproveButton({ row }: { row: AdminPledgeDto }) {
    if (row.status !== "pending") return null;
    return (
      <Button
        type="button"
        size="sm"
        onClick={() => approve(row)}
        disabled={busyId === row.id || pending}
        className="bg-campfire text-white hover:bg-campfire/90"
      >
        {busyId === row.id ? "Approving..." : "Approve"}
      </Button>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-black/5 bg-white p-6 text-sm text-neutral-600 shadow-sm">
        No pledges yet.
      </p>
    );
  }

  return (
    <div>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      {/* Phone: one card per pledge. */}
      <ul className="space-y-3 sm:hidden">
        {rows.map((row) => (
          <li
            key={row.id}
            className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="tabular font-semibold text-navy">
                {row.reference}
              </span>
              <StatusBadge status={row.status} />
            </div>

            <p className="mt-2 text-sm text-neutral-800">{row.fullName}</p>

            <div className="mt-1 flex items-baseline justify-between gap-3">
              <span className="tabular text-lg font-semibold text-navy">
                {formatKes(row.amountMinor)}
              </span>
              <span className="text-xs text-neutral-500">
                {formatDate(row.createdAt)}
              </span>
            </div>

            {row.status === "pending" && (
              <div className="mt-3">
                <ApproveButton row={row} />
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* Small breakpoint and up: the full table. */}
      <div className="hidden overflow-x-auto rounded-2xl border border-black/5 bg-white shadow-sm sm:block">
        <table className="w-full text-sm">
          <caption className="sr-only">
            All pledges, newest first, with an approve action for pending ones
          </caption>
          <thead>
            <tr className="border-b border-neutral-100 text-left text-neutral-500">
              <th scope="col" className="px-4 py-3 font-medium">Reference</th>
              <th scope="col" className="px-4 py-3 font-medium">Name</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Amount</th>
              <th scope="col" className="px-4 py-3 font-medium">Date</th>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="tabular px-4 py-3 font-medium text-navy">
                  {row.reference}
                </td>
                <td className="px-4 py-3 text-neutral-800">{row.fullName}</td>
                <td className="tabular px-4 py-3 text-right font-medium text-navy">
                  {formatKes(row.amountMinor)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-neutral-600">
                  {formatDate(row.createdAt)}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={row.status} />
                </td>
                <td className="px-4 py-3 text-right">
                  <ApproveButton row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
