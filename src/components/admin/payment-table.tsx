import { formatDate, formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The treasurer's payment book.
 *
 * Two renderings of the same rows: stacked cards on a phone, a table from the
 * small breakpoint up, matching the pledge list. A payment book is read on a
 * phone after a service at least as often as at a desk.
 *
 * No client JavaScript. Nothing here is interactive, and paging is ordinary
 * links, so this stays a server component and the page works with scripting
 * off.
 *
 * Amounts arrive as minor unit strings and stay strings. Nothing here turns a
 * money value into a JavaScript number.
 */

export type AdminPaymentDto = {
  id: string;
  paidAt: string;
  method: string;
  externalRef: string | null;
  amountMinor: string;
  payerName: string | null;
  allocatedMinor: string;
  unallocatedMinor: string;
  allocationStatus: "unallocated" | "partial" | "fully_allocated";
};

/**
 * Unallocated is red because it is the state that needs work, not the state
 * that is wrong. Money sitting unmatched is money no pledge has been credited
 * with, and that is what this screen exists to surface.
 */
const ALLOCATION_STYLES: Record<AdminPaymentDto["allocationStatus"], string> = {
  fully_allocated: "bg-emerald-100 text-emerald-900",
  partial: "bg-amber-100 text-amber-900",
  unallocated: "bg-red-100 text-red-900",
};

const ALLOCATION_LABELS: Record<AdminPaymentDto["allocationStatus"], string> = {
  fully_allocated: "Fully allocated",
  partial: "Partial",
  unallocated: "Unallocated",
};

function AllocationBadge({ row }: { row: AdminPaymentDto }) {
  return (
    <span
      className={cn(
        "inline-block rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
        ALLOCATION_STYLES[row.allocationStatus],
      )}
    >
      {ALLOCATION_LABELS[row.allocationStatus]}
      {row.allocationStatus === "partial" && (
        <span className="font-normal">
          {" "}
          ({formatKES(row.unallocatedMinor)} left)
        </span>
      )}
    </span>
  );
}

/** A cash payment carries no receipt number, and a dash reads better than nothing. */
function Reference({ value }: { value: string | null }) {
  if (!value) return <span className="text-neutral-400">None</span>;
  return <span className="tabular">{value}</span>;
}

export function PaymentTable({ rows }: { rows: AdminPaymentDto[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-black/5 bg-white p-6 text-sm text-neutral-600 shadow-sm">
        No payments recorded yet.
      </p>
    );
  }

  return (
    <div>
      {/* Phone: one card per payment. */}
      <ul className="space-y-3 sm:hidden">
        {rows.map((row) => (
          <li
            key={row.id}
            className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="font-semibold text-navy capitalize">
                {row.method}
              </span>
              <AllocationBadge row={row} />
            </div>

            <p className="mt-2 text-sm text-neutral-800">
              {row.payerName ?? "No payer recorded"}
            </p>

            <p className="mt-1 text-xs text-neutral-500">
              <Reference value={row.externalRef} />
            </p>

            <div className="mt-2 flex items-baseline justify-between gap-3">
              <span className="tabular text-lg font-semibold text-navy">
                {formatKES(row.amountMinor)}
              </span>
              <span className="text-xs text-neutral-500">
                {formatDate(row.paidAt)}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {/* Small breakpoint and up: the full table. */}
      <div className="hidden overflow-x-auto rounded-2xl border border-black/5 bg-white shadow-sm sm:block">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Every payment recorded, newest first, with how much of each has been
            allocated to a pledge
          </caption>
          <thead>
            <tr className="border-b border-neutral-100 text-left text-neutral-500">
              <th scope="col" className="px-4 py-3 font-medium">Date</th>
              <th scope="col" className="px-4 py-3 font-medium">Method</th>
              <th scope="col" className="px-4 py-3 font-medium">Reference</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Amount</th>
              <th scope="col" className="px-4 py-3 font-medium">Payer</th>
              <th scope="col" className="px-4 py-3 font-medium">Allocation</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3 whitespace-nowrap text-neutral-600">
                  {formatDate(row.paidAt)}
                </td>
                <td className="px-4 py-3 text-neutral-800 capitalize">
                  {row.method}
                </td>
                <td className="px-4 py-3 text-neutral-600">
                  <Reference value={row.externalRef} />
                </td>
                <td className="tabular px-4 py-3 text-right font-medium text-navy">
                  {formatKES(row.amountMinor)}
                </td>
                <td className="px-4 py-3 text-neutral-800">
                  {row.payerName ?? (
                    <span className="text-neutral-400">Not recorded</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <AllocationBadge row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
