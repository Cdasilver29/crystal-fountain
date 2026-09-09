"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { MatchBadge, type MatchReason } from "@/components/admin/match-badge";
import { formatKES, groupDigits } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Matching a payment to a pledge, and unmatching it.
 *
 * The only client JavaScript on the payment screen. A viewer never renders it,
 * so their page stays static; a treasurer gets the allocate flow; an admin also
 * gets the remove buttons. None of that is a security boundary. Both endpoints
 * behind this check the role again and write an admin.forbidden row if someone
 * calls them directly.
 *
 * Amounts are minor unit strings throughout and become bigint only for
 * comparisons. Nothing here turns a money value into a JavaScript number.
 */

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
const MINOR_UNITS_PER_KES = 100n;

/** A pledge that can be allocated to, from either a suggestion or a search. */
export type Candidate = {
  pledgeId: string;
  reference: string;
  fullName: string;
  outstandingMinor: string;
  matchReason?: MatchReason;
};

type ProblemBody = { title?: string; errors?: Record<string, string> };

/** Reads the message out of an application/problem+json body. */
async function problemMessage(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as ProblemBody | null;
  if (!body) return fallback;
  const firstFieldError = body.errors ? Object.values(body.errors)[0] : null;
  return firstFieldError ?? body.title ?? fallback;
}

/**
 * The amount to offer for this pledge.
 *
 * The lesser of what is left on the payment and what the pledge still owes,
 * which is the same rule the service applies when no amount is sent. Working it
 * out here as well is so the treasurer sees the figure before confirming, not
 * so the client decides it.
 */
function defaultAmountMinor(
  unallocatedMinor: string,
  outstandingMinor: string,
): bigint {
  const remainder = BigInt(unallocatedMinor);
  const outstanding = BigInt(outstandingMinor);
  return remainder < outstanding ? remainder : outstanding;
}

function Row({
  candidate,
  onAllocate,
  disabled,
}: {
  candidate: Candidate;
  onAllocate: (candidate: Candidate) => void;
  disabled: boolean;
}) {
  return (
    <li className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="tabular font-semibold text-navy">
            {candidate.reference}
          </p>
          <p className="mt-1 text-sm text-neutral-800">{candidate.fullName}</p>
        </div>
        {candidate.matchReason && <MatchBadge reason={candidate.matchReason} />}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="tabular text-sm text-neutral-600">
          <span className="font-medium text-navy">
            {formatKES(candidate.outstandingMinor)}
          </span>{" "}
          outstanding
        </p>

        <button
          type="button"
          onClick={() => onAllocate(candidate)}
          disabled={disabled}
          className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg bg-campfire px-4 text-sm font-semibold text-white transition-colors hover:bg-[#ef7433] focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          Allocate
        </button>
      </div>
    </li>
  );
}

export function AllocatePanel({
  paymentId,
  unallocatedMinor,
  suggestions,
}: {
  paymentId: string;
  unallocatedMinor: string;
  suggestions: Candidate[];
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Candidate | null>(null);
  const [amountDigits, setAmountDigits] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirmRef = useRef<HTMLDivElement | null>(null);

  /*
   * Debounced search.
   *
   * The timer is cleared and the in flight request aborted on every keystroke,
   * so a slow response for "CF26" can never land after a fast one for
   * "CF26-0001" and overwrite it. Without the abort the list would flicker back
   * to stale results.
   */
  useEffect(() => {
    const term = query.trim();

    if (term.length < MIN_QUERY_LENGTH) {
      setResults(null);
      setSearching(false);
      setSearchError(null);
      return;
    }

    const controller = new AbortController();
    setSearching(true);

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/admin/pledges/search?q=${encodeURIComponent(term)}`,
          { signal: controller.signal },
        );

        if (!response.ok) {
          setSearchError(await problemMessage(response, "Could not search."));
          setResults([]);
          return;
        }

        const body = (await response.json()) as { results: Candidate[] };
        setSearchError(null);
        setResults(body.results);
      } catch (error) {
        // An abort is this effect being superseded, not a failure.
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSearchError("Could not reach the server.");
        setResults([]);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  function choose(candidate: Candidate) {
    const suggested = defaultAmountMinor(
      unallocatedMinor,
      candidate.outstandingMinor,
    );
    setSelected(candidate);
    setAmountDigits((suggested / MINOR_UNITS_PER_KES).toString());
    setAmountError(null);
    setFormError(null);
    // Move focus to the confirmation, so a keyboard user is not left where the
    // button they pressed used to be.
    requestAnimationFrame(() => confirmRef.current?.focus());
  }

  function cancel() {
    setSelected(null);
    setAmountDigits("");
    setAmountError(null);
    setFormError(null);
  }

  async function confirm() {
    if (!selected) return;

    const shillings = amountDigits.replace(/\D/g, "");

    if (shillings === "" || BigInt(shillings) <= 0n) {
      setAmountError("Enter an amount greater than zero.");
      return;
    }

    const typedMinor = BigInt(shillings) * MINOR_UNITS_PER_KES;
    const suggested = defaultAmountMinor(
      unallocatedMinor,
      selected.outstandingMinor,
    );

    if (typedMinor > BigInt(unallocatedMinor)) {
      setAmountError(
        `That payment only has ${formatKES(unallocatedMinor)} left to allocate.`,
      );
      return;
    }

    if (typedMinor > BigInt(selected.outstandingMinor)) {
      setAmountError(
        `${selected.reference} only has ${formatKES(selected.outstandingMinor)} outstanding.`,
      );
      return;
    }

    setBusy(true);
    setAmountError(null);
    setFormError(null);

    /*
     * An untouched default sends no amount at all and lets the service work it
     * out. The input is in whole shillings, so it cannot express a part
     * shilling remainder; omitting the field keeps that exact case exact
     * instead of rounding it here.
     */
    const body =
      typedMinor === suggested
        ? { pledgeId: selected.pledgeId }
        : { pledgeId: selected.pledgeId, amountMinor: typedMinor.toString() };

    try {
      const response = await fetch(
        `/api/admin/payments/${paymentId}/allocations`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        setFormError(
          await problemMessage(response, "Could not allocate that payment."),
        );
        setBusy(false);
        return;
      }

      // The route handler has already invalidated the campaign totals tag, so
      // refreshing picks up the new balance, the new remainder and the new
      // suggestions in one go.
      cancel();
      setQuery("");
      setResults(null);
      startTransition(() => {
        router.refresh();
        setBusy(false);
      });
    } catch {
      setFormError("Could not reach the server.");
      setBusy(false);
    }
  }

  const working = busy || refreshing;

  return (
    <div className="flex flex-col gap-8">
      {selected && (
        <div
          ref={confirmRef}
          tabIndex={-1}
          role="group"
          aria-label={`Confirm allocation to ${selected.reference}`}
          className="rounded-2xl border-2 border-campfire bg-white p-5 shadow-sm focus-visible:outline-none"
        >
          <h3 className="text-base font-semibold text-navy">
            Allocate to {selected.reference}
          </h3>
          <p className="mt-1 text-sm text-neutral-700">
            {selected.fullName}, {formatKES(selected.outstandingMinor)}{" "}
            outstanding. This payment has {formatKES(unallocatedMinor)} left to
            allocate.
          </p>

          <div className="mt-4">
            <label
              htmlFor="allocation-amount"
              className="block text-sm font-medium text-navy"
            >
              Amount in Kenyan shillings
            </label>
            <div className="mt-1.5 flex items-baseline gap-2 border-b-2 border-neutral-200 pb-2 has-[:focus-visible]:border-campfire">
              <span className="text-xl font-medium text-neutral-400">KES</span>
              <input
                id="allocation-amount"
                // Text with a numeric input mode, so the grouped digits survive
                // and a phone still offers the number keypad.
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                value={groupDigits(amountDigits)}
                onChange={(event) => {
                  setAmountDigits(event.target.value.replace(/\D/g, ""));
                  setAmountError(null);
                }}
                aria-invalid={amountError ? true : undefined}
                aria-describedby={amountError ? "allocation-amount-error" : undefined}
                className="tabular w-full bg-transparent text-xl font-semibold text-navy outline-none"
              />
            </div>
            {amountError && (
              <p
                id="allocation-amount-error"
                role="alert"
                className="mt-2 text-sm text-red-700"
              >
                {amountError}
              </p>
            )}
          </div>

          {formError && (
            <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={confirm}
              disabled={working}
              className="inline-flex h-11 cursor-pointer items-center justify-center rounded-lg bg-campfire px-6 text-base font-semibold text-white transition-colors hover:bg-[#ef7433] focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
              {working ? "Allocating..." : "Confirm allocation"}
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={working}
              className="inline-flex h-11 cursor-pointer items-center justify-center rounded-lg border border-neutral-300 px-6 text-base font-medium text-navy transition-colors hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <section aria-labelledby="suggestions-heading">
        <h2
          id="suggestions-heading"
          className="mb-1 text-lg font-semibold text-navy"
        >
          Suggested matches
        </h2>
        <p className="mb-3 text-sm text-neutral-600">
          Pledges this payment may belong to, best guess first. A reference
          match is what the payer typed as the account number, so it is the
          strongest signal. A name match is only a guess.
        </p>

        {suggestions.length === 0 ? (
          <p className="rounded-2xl border border-black/5 bg-white p-6 text-sm text-neutral-600 shadow-sm">
            No pledge looks like a match for this payment. Search for one below.
          </p>
        ) : (
          <ul className="space-y-3">
            {suggestions.map((candidate) => (
              <Row
                key={candidate.pledgeId}
                candidate={candidate}
                onAllocate={choose}
                disabled={working}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="search-heading">
        <h2 id="search-heading" className="mb-1 text-lg font-semibold text-navy">
          Search for a pledge
        </h2>
        <p className="mb-3 text-sm text-neutral-600">
          By reference, phone number or name.
        </p>

        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="CF26-000124, 0712 345 678, or a name"
          aria-label="Search pledges by reference, phone number or name"
          className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-base text-navy focus-visible:border-campfire focus-visible:ring-2 focus-visible:ring-campfire/40 focus-visible:outline-none"
        />

        <div aria-live="polite" className="mt-3">
          {searching && (
            <p className="text-sm text-neutral-500">Searching...</p>
          )}

          {searchError && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {searchError}
            </p>
          )}

          {!searching && results !== null && results.length === 0 && !searchError && (
            <p className="rounded-2xl border border-black/5 bg-white p-6 text-sm text-neutral-600 shadow-sm">
              No pledge matches that.
            </p>
          )}

          {results !== null && results.length > 0 && (
            <ul className={cn("space-y-3", searching && "opacity-60")}>
              {results.map((candidate) => (
                <Row
                  key={candidate.pledgeId}
                  candidate={candidate}
                  onAllocate={choose}
                  disabled={working}
                />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * Undoing a match, for a correction. Admin only.
 *
 * Two presses, because this moves a balance somebody may already have been told
 * about. The confirmation names the pledge and the amount rather than asking
 * "are you sure", so what is about to happen is on screen when it is confirmed.
 *
 * Deliberately not window.confirm, which cannot say any of that and blocks the
 * page while it is open.
 */
export function RemoveAllocationButton({
  paymentId,
  allocationId,
  pledgeReference,
  amountMinor,
}: {
  paymentId: string;
  allocationId: string;
  pledgeReference: string;
  amountMinor: string;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/admin/payments/${paymentId}/allocations/${allocationId}`,
        { method: "DELETE" },
      );

      if (!response.ok) {
        setError(
          await problemMessage(response, "Could not remove that allocation."),
        );
        setBusy(false);
        return;
      }

      startTransition(() => {
        router.refresh();
        setBusy(false);
        setConfirming(false);
      });
    } catch {
      setError("Could not reach the server.");
      setBusy(false);
    }
  }

  const working = busy || refreshing;

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="cursor-pointer rounded text-sm font-medium text-red-700 underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
      >
        Remove
        <span className="sr-only">
          {" "}
          the {formatKES(amountMinor)} allocated to {pledgeReference}
        </span>
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <p className="text-xs text-neutral-600">
        Remove {formatKES(amountMinor)} from {pledgeReference}?
      </p>

      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={remove}
          disabled={working}
          className="inline-flex h-8 cursor-pointer items-center justify-center rounded-lg bg-red-700 px-3 text-xs font-semibold text-white transition-colors hover:bg-red-800 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          {working ? "Removing..." : "Yes, remove"}
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
          disabled={working}
          className="inline-flex h-8 cursor-pointer items-center justify-center rounded-lg border border-neutral-300 px-3 text-xs font-medium text-navy transition-colors hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          Keep
        </button>
      </div>
    </div>
  );
}
