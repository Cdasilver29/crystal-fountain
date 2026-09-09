import { MatchBadge, type MatchReason } from "@/components/admin/match-badge";
import { RemoveAllocationButton } from "@/components/admin/payment-allocate";
import { formatDate, formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The read-only halves of the payment detail screen.
 *
 * Server components. Nothing here is interactive, so none of it ships
 * JavaScript. The allocate and remove controls are a separate client component
 * and are not part of this file.
 *
 * Amounts arrive as minor unit strings and stay strings. Nothing here turns a
 * money value into a JavaScript number.
 */

export type AllocationDto = {
  id: string;
  pledgeId: string;
  pledgeReference: string;
  pledgerName: string;
  amountMinor: string;
  allocatedAt: string;
  allocatedByName: string | null;
  reversedAt: string | null;
  reversedByName: string | null;
};

export type SuggestionDto = {
  pledgeId: string;
  reference: string;
  fullName: string;
  outstandingMinor: string;
  matchReason: MatchReason;
  confidence: "high" | "medium" | "low";
};

/** A labelled figure in the details block. */
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-neutral-900">{children}</dd>
    </div>
  );
}

/** Renders a value that may be missing, without leaving a blank gap. */
export function OrNone({ value }: { value: string | null }) {
  if (!value) return <span className="text-neutral-400">Not recorded</span>;
  return <>{value}</>;
}

/**
 * How much of this payment still needs a home.
 *
 * The remainder is the number the treasurer is actually working against, so it
 * is the largest thing on the screen. The bar underneath is a second reading of
 * the same fact, not a separate one.
 */
export function UnallocatedSummary({
  amountMinor,
  allocatedMinor,
  unallocatedMinor,
  percentAllocated,
}: {
  amountMinor: string;
  allocatedMinor: string;
  unallocatedMinor: string;
  percentAllocated: number;
}) {
  const settled = unallocatedMinor === "0";

  return (
    <div className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
      <p className="text-sm text-neutral-600">
        {settled ? "All of this payment is allocated" : "Still to allocate"}
      </p>

      <p
        className={cn(
          "tabular mt-1 text-2xl font-semibold",
          settled ? "text-emerald-700" : "text-campfire",
        )}
      >
        {formatKES(unallocatedMinor)}
        <span className="text-base font-normal text-neutral-500">
          {" "}
          of {formatKES(amountMinor)} unallocated
        </span>
      </p>

      <div
        className="mt-4 h-2 w-full overflow-hidden rounded-full bg-neutral-200"
        role="img"
        aria-label={`${formatKES(allocatedMinor)} of ${formatKES(amountMinor)} allocated`}
      >
        <div
          className={cn(
            "h-full rounded-full",
            settled ? "bg-emerald-600" : "bg-campfire",
          )}
          // Clamped, so a rounding artefact can never overflow the track.
          style={{ width: `${Math.min(100, Math.max(0, percentAllocated))}%` }}
        />
      </div>

      <p className="mt-2 text-xs text-neutral-500">
        {formatKES(allocatedMinor)} matched to pledges
      </p>
    </div>
  );
}

/**
 * What this payment has already been matched to.
 *
 * Reversed allocations are shown, struck through and muted, rather than hidden.
 * They count toward no balance, but they are part of what happened to this
 * money, and a screen that dropped them would disagree with the ledger.
 */
export function AllocationsTable({
  rows,
  paymentId,
  canRemove,
}: {
  rows: AllocationDto[];
  paymentId: string;
  /**
   * Admin only. Hiding the button is presentation and nothing more: the DELETE
   * endpoint makes the same check and writes an admin.forbidden row if a
   * treasurer calls it directly.
   */
  canRemove: boolean;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-black/5 bg-white p-6 text-sm text-neutral-600 shadow-sm">
        Nothing has been matched to this payment yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-black/5 bg-white shadow-sm">
      <table className="w-full text-sm">
        <caption className="sr-only">
          Pledges this payment has been allocated to, including any allocation
          that was later reversed
        </caption>
        <thead>
          <tr className="border-b border-neutral-100 text-left text-neutral-500">
            <th scope="col" className="px-4 py-3 font-medium">Pledge</th>
            <th scope="col" className="px-4 py-3 font-medium">Pledger</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">Amount</th>
            <th scope="col" className="px-4 py-3 font-medium">Allocated</th>
            <th scope="col" className="px-4 py-3 font-medium">By</th>
            {canRemove && (
              <th scope="col" className="px-4 py-3 text-right font-medium">
                <span className="sr-only">Action</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((row) => {
            const reversed = row.reversedAt !== null;
            return (
              <tr key={row.id} className={cn(reversed && "text-neutral-400")}>
                <td className="tabular px-4 py-3 font-medium">
                  <span className={cn(reversed ? "line-through" : "text-navy")}>
                    {row.pledgeReference}
                  </span>
                  {reversed && (
                    <span className="ml-2 rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium text-neutral-600">
                      Reversed
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">{row.pledgerName}</td>
                <td
                  className={cn(
                    "tabular px-4 py-3 text-right font-medium",
                    reversed ? "line-through" : "text-navy",
                  )}
                >
                  {formatKES(row.amountMinor)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {formatDate(row.allocatedAt)}
                </td>
                <td className="px-4 py-3">
                  {reversed ? (
                    <>
                      {row.allocatedByName ?? "Unknown"}, reversed by{" "}
                      {row.reversedByName ?? "Unknown"}
                    </>
                  ) : (
                    (row.allocatedByName ?? "Unknown")
                  )}
                </td>
                {canRemove && (
                  <td className="px-4 py-3 text-right">
                    {/* A reversed allocation cannot be reversed again. */}
                    {!reversed && (
                      <RemoveAllocationButton
                        paymentId={paymentId}
                        allocationId={row.id}
                        pledgeReference={row.pledgeReference}
                        amountMinor={row.amountMinor}
                      />
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Pledges this payment might belong to, best guess first. */
export function SuggestionList({ rows }: { rows: SuggestionDto[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-black/5 bg-white p-6 text-sm text-neutral-600 shadow-sm">
        No pledge looks like a match for this payment. Search for one instead.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li
          key={row.pledgeId}
          className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="tabular font-semibold text-navy">{row.reference}</p>
              <p className="mt-1 text-sm text-neutral-800">{row.fullName}</p>
            </div>
            <MatchBadge reason={row.matchReason} />
          </div>

          <p className="tabular mt-3 text-sm text-neutral-600">
            <span className="font-medium text-navy">
              {formatKES(row.outstandingMinor)}
            </span>{" "}
            outstanding
          </p>
        </li>
      ))}
    </ul>
  );
}
