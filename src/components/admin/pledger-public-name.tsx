"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The name a pledger is published under, on the pledge detail screen.
 *
 * Shows what the public pages render right now, and for a treasurer an edit
 * control beside it. The input opens prefilled with that rendered name rather
 * than the stored one, because the usual fix is a small correction to what is
 * already shown ("Petet O." to "Peter O."), not retyping from the full name.
 *
 * Reset is its own action and only offered when a name has been set by hand,
 * since there is nothing to reset otherwise.
 */
export function PledgerPublicName({
  pledgeId,
  shownAs,
  isOverride,
  canEdit,
}: {
  pledgeId: string;
  /** What the public pages render for this pledger now. */
  shownAs: string;
  /** Whether that name was set by hand rather than derived. */
  isOverride: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const inputId = useId();
  const helpId = useId();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(shownAs);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(publicDisplayName: string | null) {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/admin/pledges/${pledgeId}/display-name`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ publicDisplayName }),
        },
      );
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setError(
          body?.errors?.publicDisplayName ??
            body?.title ??
            "We could not save that.",
        );
        return;
      }

      setEditing(false);
      router.refresh();
    } catch {
      setError("We could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save(value);
        }}
        className="w-full"
      >
        <label htmlFor={inputId} className="sr-only">
          Shown publicly as
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id={inputId}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            maxLength={80}
            autoFocus
            aria-describedby={helpId}
            className="h-9 min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 text-sm text-navy focus-visible:border-campfire focus-visible:ring-2 focus-visible:ring-campfire/30 focus-visible:outline-none"
          />
          <button
            type="submit"
            disabled={busy}
            className="h-9 rounded-lg bg-navy px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Saving" : "Save"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setEditing(false);
              setValue(shownAs);
              setError(null);
            }}
            className="h-9 rounded-lg px-3 text-sm text-neutral-600 hover:text-navy"
          >
            Cancel
          </button>
        </div>
        <p id={helpId} className="mt-2 text-xs text-neutral-500">
          This is what visitors see on the website. The full name on the record
          does not change.
        </p>
        {error ? (
          <p role="alert" className="mt-2 text-xs text-red-700">
            {error}
          </p>
        ) : null}
      </form>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-medium text-navy">{shownAs}</span>
        <span className="text-xs text-neutral-500">
          {isOverride ? "set by hand" : "automatic"}
        </span>
        {canEdit && (
          <>
            <button
              type="button"
              onClick={() => {
                setValue(shownAs);
                setEditing(true);
              }}
              className="text-sm font-medium text-campfire underline-offset-4 hover:underline"
            >
              Edit
            </button>
            {isOverride && (
              <button
                type="button"
                disabled={busy}
                onClick={() => save(null)}
                className="text-sm text-neutral-600 underline-offset-4 hover:text-navy hover:underline disabled:opacity-50"
              >
                Reset to automatic
              </button>
            )}
          </>
        )}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
