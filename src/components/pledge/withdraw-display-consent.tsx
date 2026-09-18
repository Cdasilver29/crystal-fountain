"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Taking your own name off the public list.
 *
 * The one control on this site that changes something without anybody
 * approving it. Under the Data Protection Act withdrawing consent has to be as
 * easy as giving it, and giving it was one unticked checkbox on the pledge
 * form, so this is two presses and no waiting: one to open it, one to confirm.
 *
 * Two presses rather than one because it is not reversible from here. Putting a
 * name back on the list means pledging again with the same number and ticking
 * the box, which is deliberate, and somebody who taps the wrong thing on a
 * phone should not discover that afterwards.
 *
 * It does not offer the opposite direction. Adding a name to a public page
 * needs the person's deliberate act on the pledge form, and a control that
 * could put one back would make this a switch rather than a withdrawal.
 */
export function WithdrawDisplayConsent({
  reference,
  phone,
  onWithdrawn,
}: {
  reference: string;
  /** The number already proved against this reference by the lookup. */
  phone: string;
  /** Lets the panel above stop offering it once it is done. */
  onWithdrawn: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withdraw() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/redeem/display-consent", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reference, phone }),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setError(
          body?.title ??
            "We could not do that just now. Please try again in a moment.",
        );
        setBusy(false);
        return;
      }

      if (!body?.found) {
        setError(
          "We could not find that pledge. Please look it up again and retry.",
        );
        setBusy(false);
        return;
      }

      /*
       * "changed" being false means it was already off, which is not a failure
       * and is not worth telling somebody about. Either way their name is not
       * on the list, which is what they asked for.
       */
      setDone(true);
      setBusy(false);
      onWithdrawn();
    } catch {
      setError("We could not reach the server. Check your connection.");
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p
        role="status"
        className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-relaxed text-emerald-900"
      >
        Your name has been taken off the public list. Your pledge itself is
        unchanged and still counts toward the total.
      </p>
    );
  }

  if (!armed) {
    return (
      <div className="mt-5 border-t border-neutral-100 pt-5">
        <p className="text-sm leading-relaxed text-neutral-600">
          Your name appears on the public list of pledgers because you agreed to
          it when you pledged. You can take it off at any time, and you do not
          need anybody&rsquo;s permission.
        </p>
        <button
          type="button"
          onClick={() => setArmed(true)}
          className="mt-2 rounded text-sm font-medium text-denim underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
        >
          Remove my name from the public list
        </button>
      </div>
    );
  }

  return (
    <div className="mt-5 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
      <p className="text-sm leading-relaxed text-neutral-700">
        Your name will stop appearing on the pledgers list and on the home page
        straight away. Your pledge is not affected: it still stands and it still
        counts toward the campaign total. To be listed again you would need to
        pledge again with this number and tick the box.
      </p>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={withdraw}
          className="bg-navy text-white hover:bg-navy/90"
        >
          {busy ? "Removing…" : "Yes, remove my name"}
        </Button>

        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setArmed(false);
            setError(null);
          }}
        >
          Keep it listed
        </Button>
      </div>
    </div>
  );
}
