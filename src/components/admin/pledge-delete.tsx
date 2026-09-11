"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Removing a pledge, in two deliberate steps.
 *
 * The first press only arms it. Nothing on this screen is as consequential as
 * this one control, and a single click next to an Edit button is how somebody
 * takes money off the congregation's figure by accident.
 *
 * The wording is careful not to promise more than is true. The row is not
 * destroyed and the journal keeps the whole pledge, but from the point of view
 * of anybody using this platform it is gone, and saying "this cannot be undone"
 * is the honest summary of that.
 */
export function PledgeDelete({
  pledgeId,
  reference,
  paidMinorIsZero,
}: {
  pledgeId: string;
  reference: string;
  /** Whether anything is still matched to it, so the warning can say so. */
  paidMinorIsZero: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/pledges/${pledgeId}/delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: reason || undefined }),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setError(body?.title ?? "We could not remove that pledge.");
        setBusy(false);
        return;
      }

      // Back to the list, with a full navigation so the server re-reads the
      // totals rather than handing back a cached payload that still counts it.
      window.location.assign("/admin/pledges");
    } catch {
      setError("We could not reach the server. Check your connection.");
      setBusy(false);
    }
  }

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:border-red-300 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
      >
        Remove pledge
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
      <h2 className="font-semibold text-red-900">
        Are you sure? This cannot be undone.
      </h2>

      <p className="mt-2 text-sm leading-relaxed text-red-900/80">
        {reference} will stop counting toward the campaign total and will
        disappear from every list, export and public page.
        {!paidMinorIsZero &&
          " Any payment matched to it will be un-matched first, and that money will need matching to something else."}{" "}
        The record itself is kept in the audit log, but nothing in this portal
        will show it again.
      </p>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-white px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      <div className="mt-4">
        <Label htmlFor="delete-reason">Why, for the journal (optional)</Label>
        <Input
          id="delete-reason"
          value={reason}
          placeholder="Recorded twice by mistake"
          onChange={(event) => setReason(event.target.value)}
          className="mt-2 bg-white"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-800 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none disabled:opacity-60"
        >
          {busy ? "Removing" : `Yes, remove ${reference}`}
        </button>

        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setArmed(false);
            setReason("");
            setError(null);
          }}
        >
          Keep it
        </Button>
      </div>
    </div>
  );
}
