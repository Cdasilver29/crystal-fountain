"use client";

import { useRef, useState } from "react";

import type { PublicNameReviewRow } from "@/server/services/pledges";

/**
 * The bulk public name review, worked down from the keyboard.
 *
 * Every row has one input, prefilled with what the website shows now. Enter
 * saves that row and moves focus to the next input straight away, without
 * waiting for the server, so fifty rows are fifty Enters. Tab also jumps to
 * the next row's input rather than stopping on the row's buttons. Shift+Tab is
 * left alone, so stepping back reaches the previous row's Save and Reset
 * buttons for anybody who needs them without a mouse.
 *
 * A row counts as reviewed when a name has been set by hand or the heuristic
 * has nothing against it, so the progress line counts down the flagged rows
 * and nothing else. Correct names are never overridden just to move it.
 *
 * For the same reason Enter and Save write nothing when the input still says
 * what the website shows and there is nothing to decide: the row is unflagged,
 * or already set by hand. On a flagged row an unchanged save is a real
 * decision ("Antony" is fine as it is), so it is written as a hand set name,
 * clears the badge and counts.
 *
 * Rows keep the order they arrived in. Re-sorting after a save would move the
 * row under the cursor and send the next Enter somewhere unexpected.
 */

type RowState = {
  publicDisplayName: string | null;
  shownAs: string;
  value: string;
  status: "idle" | "saving" | "saved" | "error";
  error: string | null;
};

const SAVED_FOR_MS = 2_000;

export function DisplayNameReview({ rows }: { rows: PublicNameReviewRow[] }) {
  const [state, setState] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      rows.map((row) => [
        row.pledgerId,
        {
          publicDisplayName: row.publicDisplayName,
          shownAs: row.shownAs,
          value: row.shownAs,
          status: "idle",
          error: null,
        } satisfies RowState,
      ]),
    ),
  );
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const patch = (pledgerId: string, next: Partial<RowState>) =>
    setState((current) => ({
      ...current,
      [pledgerId]: { ...current[pledgerId], ...next },
    }));

  const focusRow = (index: number) => {
    const input = inputs.current[index];
    if (!input) return false;
    input.focus();
    return true;
  };

  /** Whether a save would change nothing and decide nothing. */
  const nothingToSave = (row: PublicNameReviewRow) => {
    const current = state[row.pledgerId];
    const flagged = current.publicDisplayName === null && row.automaticReview !== null;
    return !flagged && current.value.trim() === current.shownAs;
  };

  async function save(row: PublicNameReviewRow, publicDisplayName: string | null) {
    if (publicDisplayName !== null && nothingToSave(row)) return;

    if (publicDisplayName !== null && !publicDisplayName.trim()) {
      patch(row.pledgerId, {
        status: "error",
        error: "Enter the name to show, or reset it to automatic.",
      });
      return;
    }

    patch(row.pledgerId, { status: "saving", error: null });

    try {
      const response = await fetch(
        `/api/admin/pledges/${row.pledgeId}/display-name`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ publicDisplayName }),
        },
      );
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        patch(row.pledgerId, {
          status: "error",
          error:
            body?.errors?.publicDisplayName ??
            body?.title ??
            "We could not save that.",
        });
        return;
      }

      patch(row.pledgerId, {
        publicDisplayName: body.publicDisplayName,
        shownAs: body.shownAs,
        value: body.shownAs,
        status: "saved",
      });
      setTimeout(() => {
        setState((current) =>
          current[row.pledgerId]?.status === "saved"
            ? { ...current, [row.pledgerId]: { ...current[row.pledgerId], status: "idle" } }
            : current,
        );
      }, SAVED_FOR_MS);
    } catch {
      patch(row.pledgerId, {
        status: "error",
        error: "We could not reach the server. Check your connection.",
      });
    }
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-black/5 bg-white p-6 text-sm text-neutral-600 shadow-sm">
        Nobody has agreed to be shown publicly yet.
      </p>
    );
  }

  const reviewed = rows.filter(
    (row) =>
      state[row.pledgerId].publicDisplayName !== null ||
      row.automaticReview === null,
  ).length;

  return (
    <div>
      <p className="mb-4 text-sm text-neutral-600" aria-live="polite">
        {reviewed} of {rows.length} reviewed
      </p>

      <div className="rounded-2xl border border-black/5 bg-white shadow-sm">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Public names, the ones that need checking first
          </caption>
          <thead className="hidden sm:table-header-group">
            <tr className="border-b border-neutral-100 text-left text-neutral-500">
              <th scope="col" className="px-4 py-3 font-medium">Name as typed</th>
              <th scope="col" className="px-4 py-3 font-medium">Shown now</th>
              <th scope="col" className="px-4 py-3 font-medium">Shown publicly as</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((row, index) => {
              const current = state[row.pledgerId];
              const reason =
                current.publicDisplayName === null ? row.automaticReview : null;
              const inputId = `public-name-${row.pledgerId}`;
              const messageId = `${inputId}-message`;

              return (
                <tr key={row.pledgerId} className="block sm:table-row">
                  <td className="block px-4 pt-3 sm:table-cell sm:py-3">
                    <span className="text-neutral-800">{row.storedName}</span>
                    <span className="tabular ml-2 text-xs text-neutral-500">
                      {row.reference}
                    </span>
                  </td>
                  <td className="block px-4 pt-1 sm:table-cell sm:py-3">
                    <span className="font-medium text-navy">{current.shownAs}</span>
                    {reason ? (
                      <span
                        title={`Public name: ${reason}`}
                        className="ml-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-amber-900"
                      >
                        Check name
                      </span>
                    ) : current.publicDisplayName !== null ? (
                      <span className="ml-2 text-xs text-neutral-500">Edited</span>
                    ) : null}
                  </td>
                  <td className="block px-4 pt-2 pb-3 sm:table-cell sm:py-3">
                    <label htmlFor={inputId} className="sr-only">
                      Shown publicly as, for {row.storedName}
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        id={inputId}
                        ref={(element) => {
                          inputs.current[index] = element;
                        }}
                        value={current.value}
                        onChange={(event) =>
                          patch(row.pledgerId, {
                            value: event.target.value,
                            status: "idle",
                            error: null,
                          })
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void save(row, current.value.trim());
                            focusRow(index + 1);
                          } else if (
                            event.key === "Tab" &&
                            !event.shiftKey &&
                            focusRow(index + 1)
                          ) {
                            event.preventDefault();
                          }
                        }}
                        maxLength={80}
                        autoComplete="off"
                        spellCheck={false}
                        aria-describedby={messageId}
                        aria-invalid={current.status === "error"}
                        className="h-9 min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 text-sm text-navy focus-visible:border-campfire focus-visible:ring-2 focus-visible:ring-campfire/30 focus-visible:outline-none sm:w-48 sm:flex-none"
                      />
                      <button
                        type="button"
                        disabled={current.status === "saving"}
                        onClick={() => save(row, current.value.trim())}
                        className="h-9 rounded-lg bg-navy px-3 text-sm font-medium text-white disabled:opacity-50"
                      >
                        Save
                      </button>
                      {current.publicDisplayName !== null && (
                        <button
                          type="button"
                          disabled={current.status === "saving"}
                          onClick={() => save(row, null)}
                          className="h-9 rounded-lg px-2 text-sm text-neutral-600 underline-offset-4 hover:text-navy hover:underline disabled:opacity-50"
                        >
                          Reset to automatic
                        </button>
                      )}
                    </div>
                    <p
                      id={messageId}
                      role={current.status === "error" ? "alert" : undefined}
                      className={
                        current.status === "error"
                          ? "mt-1 text-xs text-red-700"
                          : "mt-1 text-xs text-emerald-700"
                      }
                    >
                      {current.status === "saving"
                        ? "Saving"
                        : current.status === "saved"
                          ? "Saved"
                          : current.status === "error"
                            ? current.error
                            : null}
                    </p>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
