"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { formatKES } from "@/lib/format";
import {
  CONFIRMATION_METHODS,
  type ConfirmationMethod,
} from "@/server/contracts/pledges";

/**
 * Additions waiting for the treasurer to confirm with the pledger.
 *
 * Each card says who to ring and on which number: the one on the pledger's
 * record, never one the submitter supplied, because the addition may have come
 * from somebody who knows nothing more than that number. Confirm stays
 * disabled until the treasurer has said how they confirmed it, which is what
 * goes into the audit row.
 */

export type HeldRow = {
  incrementId: string;
  pledgeId: string;
  reference: string;
  pledgerName: string;
  phoneOnRecord: string;
  addedMinor: string;
  currentAmountMinor: string;
  createdAt: string;
};

const when = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Nairobi",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function HeldAdditionQueue({
  rows,
  canDecide,
}: {
  rows: HeldRow[];
  canDecide: boolean;
}) {
  if (rows.length === 0) {
    return (
      <p className="mt-6 rounded-2xl border border-black/5 bg-white p-5 text-sm text-neutral-700 shadow-sm">
        Nothing is waiting. Every addition has been confirmed or rejected.
      </p>
    );
  }

  return (
    <ul className="mt-6 space-y-4">
      {rows.map((row) => (
        <li key={row.incrementId}>
          <HeldCard row={row} canDecide={canDecide} />
        </li>
      ))}
    </ul>
  );
}

function HeldCard({ row, canDecide }: { row: HeldRow; canDecide: boolean }) {
  const router = useRouter();
  const [method, setMethod] = useState<ConfirmationMethod | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "confirm" | "reject") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/held-additions/${row.incrementId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, method: method ?? undefined }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.errors?.method ?? body?.title ?? "That decision could not be recorded.");
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setError("We could not reach the server. Check your connection.");
      setBusy(false);
    }
  }

  const total = BigInt(row.currentAmountMinor) + BigInt(row.addedMinor);

  return (
    <article className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-semibold text-navy">
          {formatKES(row.addedMinor)} to add to{" "}
          <Link
            href={`/admin/pledges/${row.pledgeId}`}
            className="tabular rounded whitespace-nowrap text-denim underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
          >
            {row.reference}
          </Link>
        </h2>
        <span className="text-xs text-neutral-500">
          Received {when.format(new Date(row.createdAt))}
        </span>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div>
          <dt className="inline text-neutral-600">Pledger: </dt>
          <dd className="inline text-navy">{row.pledgerName}</dd>
        </div>
        <div>
          <dt className="inline text-neutral-600">Phone on record: </dt>
          <dd className="tabular inline font-semibold text-navy">{row.phoneOnRecord}</dd>
        </div>
        <div>
          <dt className="inline text-neutral-600">Pledge now: </dt>
          <dd className="tabular inline text-navy">{formatKES(row.currentAmountMinor)}</dd>
        </div>
        <div>
          <dt className="inline text-neutral-600">If confirmed: </dt>
          <dd className="tabular inline text-navy">{formatKES(total)}</dd>
        </div>
      </dl>

      <p className="mt-3 text-sm leading-relaxed text-neutral-700">
        This came from a browser that did not make the pledge. Ring the phone
        on record, or speak to the pledger in person, before confirming.
      </p>

      {canDecide && (
        <>
          <fieldset className="mt-4">
            <legend className="text-sm font-medium text-navy">
              How did you confirm it?
            </legend>
            <div className="mt-2 space-y-2">
              {(Object.keys(CONFIRMATION_METHODS) as ConfirmationMethod[]).map((key) => (
                <label key={key} className="flex items-start gap-3 text-sm text-neutral-800">
                  <input
                    type="radio"
                    name={`method-${row.incrementId}`}
                    value={key}
                    checked={method === key}
                    onChange={() => setMethod(key)}
                    className="mt-0.5 size-4"
                  />
                  {CONFIRMATION_METHODS[key]}
                </label>
              ))}
            </div>
          </fieldset>

          {error && (
            <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              type="button"
              disabled={busy || method === null}
              onClick={() => decide("confirm")}
            >
              {busy ? "Saving" : "Confirm and add"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => decide("reject")}
            >
              Reject
            </Button>
          </div>
        </>
      )}
    </article>
  );
}
