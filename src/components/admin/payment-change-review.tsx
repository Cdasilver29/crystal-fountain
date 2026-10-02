"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

/**
 * A payment detail change waiting for its second signature.
 *
 * Every field old beside new and whole, with the moved ones marked, because
 * the reviewer's job is to catch one substituted digit in an account number
 * and a summary would hide exactly that. Approving needs a box ticked first,
 * which is a small thing, but it puts the sentence "I have checked" in front
 * of the person about to send every future payment somewhere new.
 */

export type ReviewedChange = {
  id: string;
  requestedByName: string;
  requestedAt: string;
  expiresAt: string;
  /**
   * Every payment field, as members see it now and as they would after
   * approval. An empty field arrives already resolved to the value built into
   * the site, because that is what a member is shown.
   */
  rows: { label: string; current: string; proposed: string; moved: boolean }[];
};

const when = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Nairobi",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

export function PaymentChangeReview({
  change,
  canApprove,
  canReject,
  isRequester,
}: {
  change: ReviewedChange;
  canApprove: boolean;
  canReject: boolean;
  isRequester: boolean;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/settings/payment-changes/${change.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.title ?? body?.detail ?? "That decision could not be recorded.");
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setError("We could not reach the server. Check your connection.");
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="pending-payment-change"
      className="rounded-2xl border border-campfire/40 bg-campfire/5 p-5 sm:p-6"
    >
      <h2 id="pending-payment-change" className="font-semibold text-navy">
        A change to the payment details is waiting for approval
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-neutral-700">
        Asked for by {change.requestedByName} on {when.format(new Date(change.requestedAt))}.
        The site still shows the current details. It expires on{" "}
        {when.format(new Date(change.expiresAt))} if nobody approves it.
      </p>

      {/*
        Stacked on a phone, a table from sm up. A table on a 360px screen
        pushed the proposed column off the side, and the proposed column is the
        one a reviewer is there to read.
      */}
      <dl className="mt-4 space-y-3 text-sm sm:hidden">
        {change.rows.map((row) => (
          <div
            key={row.label}
            className={
              row.moved
                ? "rounded-lg bg-campfire/15 px-3 py-2 text-navy"
                : "px-3 text-neutral-700"
            }
          >
            <dt className={row.moved ? "font-semibold" : "font-medium"}>
              {row.label}
              {row.moved && " (changed)"}
            </dt>
            <dd className="tabular mt-1 break-words">Current: {row.current}</dd>
            {row.moved && (
              <dd className="tabular break-words font-semibold">Proposed: {row.proposed}</dd>
            )}
          </div>
        ))}
      </dl>

      <div className="mt-4 hidden sm:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-neutral-600">
              <th className="py-2 pr-3 font-medium">Field</th>
              <th className="py-2 pr-3 font-medium">Current</th>
              <th className="py-2 font-medium">Proposed</th>
            </tr>
          </thead>
          <tbody>
            {change.rows.map((row) => (
              <tr
                key={row.label}
                className={row.moved ? "bg-campfire/15 font-medium text-navy" : "text-neutral-700"}
              >
                <th scope="row" className="py-2 pr-3 font-normal">
                  {row.label}
                  {row.moved && <span className="sr-only">, changed</span>}
                </th>
                <td className="tabular py-2 pr-3 break-words">{row.current}</td>
                <td className="tabular py-2 break-words">{row.proposed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {isRequester && (
        <p className="mt-4 text-sm text-neutral-700">
          You asked for this change, so a treasurer or another administrator has to approve it.
        </p>
      )}

      {canApprove && !isRequester && (
        <label className="mt-4 flex items-start gap-3 text-sm text-neutral-800">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 size-4 rounded border-neutral-300"
          />
          I have checked every changed value against what the church agreed.
        </label>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        {canApprove && !isRequester && (
          <Button type="button" disabled={busy || !checked} onClick={() => decide("approve")}>
            {busy ? "Saving" : "Approve and make live"}
          </Button>
        )}
        {canReject && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => decide("reject")}
          >
            {isRequester ? "Withdraw this change" : "Reject"}
          </Button>
        )}
      </div>
    </section>
  );
}
