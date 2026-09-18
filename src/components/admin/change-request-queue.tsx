"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatDate, formatKES, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  CHANGE_REQUEST_LABELS,
  MIN_DECISION_NOTE_LENGTH,
  type ChangeRequestKind,
} from "@/server/contracts/change-requests";

/**
 * The queue of what pledgers have asked to have changed.
 *
 * Cards rather than a table, on every screen size. A row here is not four
 * short columns: it carries what was asked, what the pledge currently says,
 * the pledger's reason in their own words and two actions, and a table wide
 * enough for all of that is unreadable at any width. The pledge list is a
 * table because its rows really are four short columns.
 *
 * Amounts arrive as minor unit strings and stay strings. Nothing here turns a
 * money value into a JavaScript number.
 *
 * Hiding the approve button on a cancellation from somebody who may not make
 * one is presentation and nothing else. The route makes the same check, the
 * service makes it again underneath, and a refused attempt writes an
 * admin.forbidden row.
 */

export type ChangeRequestDto = {
  id: string;
  pledgeId: string;
  kind: ChangeRequestKind;
  status: string;
  reference: string;
  pledgerName: string;
  contactPhone: string;
  reason: string;
  createdAt: string;
  currentAmountMinor: string;
  currentFrequency: string | null;
  requestedAmountMinor: string | null;
  requestedFrequency: string | null;
  requestedName: string | null;
  paymentReference: string | null;
  paymentAmountMinor: string | null;
  paymentPaidOn: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
};

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-900",
  approved: "bg-emerald-100 text-emerald-900",
  declined: "bg-red-100 text-red-900",
  closed: "bg-neutral-200 text-neutral-700",
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

/** How a plan reads on the screen. one_off and semi_annually are not words. */
function planLabel(frequency: string | null): string {
  if (!frequency || frequency === "one_off") return "one payment";
  return frequency.replace(/_/g, " ");
}

/**
 * What is being asked for, as a line the treasurer can act on.
 *
 * Every kind shows what the pledge says now beside what is being asked, so a
 * decision never depends on remembering the current figure or opening the
 * pledge in another tab.
 */
function Asked({ row }: { row: ChangeRequestDto }) {
  switch (row.kind) {
    case "reduce_amount":
      return (
        <p className="text-sm text-neutral-800">
          <span className="tabular font-semibold text-navy">
            {formatKES(row.currentAmountMinor)}
          </span>{" "}
          down to{" "}
          <span className="tabular font-semibold text-navy">
            {row.requestedAmountMinor
              ? formatKES(row.requestedAmountMinor)
              : "an unstated amount"}
          </span>
        </p>
      );

    case "change_plan":
      return (
        <p className="text-sm text-neutral-800">
          {planLabel(row.currentFrequency)} to{" "}
          <span className="font-semibold text-navy">
            {planLabel(row.requestedFrequency)}
          </span>
        </p>
      );

    case "correct_name":
      return (
        <p className="text-sm text-neutral-800">
          {row.pledgerName} to{" "}
          <span className="font-semibold text-navy">{row.requestedName}</span>
        </p>
      );

    case "payment_missing":
      return (
        <div className="text-sm text-neutral-800">
          <p>
            <span className="tabular font-semibold text-navy">
              {row.paymentAmountMinor
                ? formatKES(row.paymentAmountMinor)
                : "an unstated amount"}
            </span>{" "}
            paid as{" "}
            <span className="tabular font-semibold text-navy">
              {row.paymentReference}
            </span>
          </p>
          <p className="mt-1 text-neutral-600">
            {row.paymentPaidOn ? `on ${formatDate(row.paymentPaidOn)}` : null},
            not showing against this pledge
          </p>
        </div>
      );

    case "cancel_pledge":
      return (
        <p className="text-sm text-neutral-800">
          Cancel this pledge of{" "}
          <span className="tabular font-semibold text-navy">
            {formatKES(row.currentAmountMinor)}
          </span>{" "}
          altogether
        </p>
      );
  }
}

export function ChangeRequestQueue({
  rows,
  canDecide,
  canDecideCancellation,
}: {
  rows: ChangeRequestDto[];
  /** Whether this administrator may answer anything at all. */
  canDecide: boolean;
  /** Whether they may approve a cancellation, which is a separate right. */
  canDecideCancellation: boolean;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function decide(
    row: ChangeRequestDto,
    decision: "approve" | "decline",
  ) {
    setBusyId(row.id);
    setErrors((current) => ({ ...current, [row.id]: "" }));

    try {
      const response = await fetch(
        `/api/admin/change-requests/${row.id}/decide`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            decision === "approve"
              ? { decision }
              : { decision, note: note.trim() },
          ),
        },
      );

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setErrors((current) => ({
          ...current,
          [row.id]:
            body?.errors?.note ??
            body?.title ??
            `We could not answer ${row.reference}.`,
        }));
        setBusyId(null);
        return;
      }

      /*
       * The route has already revalidated the campaign totals where the
       * decision moved them, so refreshing picks up the new status here and
       * the new public figure everywhere else.
       */
      startTransition(() => {
        router.refresh();
        setBusyId(null);
        setDecliningId(null);
        setNote("");
      });
    } catch {
      setErrors((current) => ({
        ...current,
        [row.id]: "We could not reach the server. Check your connection.",
      }));
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-black/5 bg-white p-6 text-sm text-neutral-600 shadow-sm">
        Nothing is waiting. Requests appear here when a pledger asks for
        something to be changed that the pledge form cannot do on its own.
      </p>
    );
  }

  return (
    <ul className="space-y-4">
      {rows.map((row) => {
        const busy = busyId === row.id || refreshing;
        const error = errors[row.id];
        const isCancellation = row.kind === "cancel_pledge";
        const mayApprove = canDecide && (!isCancellation || canDecideCancellation);
        const noteTooShort = note.trim().length < MIN_DECISION_NOTE_LENGTH;

        return (
          <li
            key={row.id}
            className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-navy">
                  {CHANGE_REQUEST_LABELS[row.kind]}
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  {row.pledgerName} &middot;{" "}
                  <Link
                    href={`/admin/pledges/${row.pledgeId}`}
                    className="tabular rounded underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
                  >
                    {row.reference}
                  </Link>{" "}
                  &middot; <span className="tabular">{row.contactPhone}</span>
                </p>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs text-neutral-500">
                  {formatRelativeTime(row.createdAt)}
                </span>
                <StatusBadge status={row.status} />
              </div>
            </div>

            <div className="mt-4 rounded-xl bg-neutral-50 px-4 py-3">
              <Asked row={row} />
            </div>

            <p className="mt-3 text-sm leading-relaxed text-neutral-700">
              <span className="text-neutral-500">They said: </span>
              {row.reason}
            </p>

            {row.status !== "pending" && (
              <p className="mt-3 border-t border-neutral-100 pt-3 text-sm text-neutral-600">
                {row.status === "closed"
                  ? row.decisionNote
                  : `${row.status} by ${row.decidedByName ?? "an administrator"}${
                      row.decidedAt ? ` on ${formatDate(row.decidedAt)}` : ""
                    }`}
                {row.status !== "closed" && row.decisionNote ? (
                  <span className="mt-1 block text-neutral-700">
                    &ldquo;{row.decisionNote}&rdquo;
                  </span>
                ) : null}
              </p>
            )}

            {error && (
              <p
                role="alert"
                className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {error}
              </p>
            )}

            {row.status === "pending" && canDecide && (
              <div className="mt-4">
                {decliningId === row.id ? (
                  <div className="rounded-xl border border-neutral-200 p-4">
                    <Label htmlFor={`note-${row.id}`}>
                      Why, in a sentence. The pledger is told this.
                    </Label>
                    <textarea
                      id={`note-${row.id}`}
                      value={note}
                      rows={2}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="The pledge has already been paid in full, so there is nothing to reduce."
                      className="mt-2 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base text-navy focus-visible:border-campfire focus-visible:ring-2 focus-visible:ring-campfire/40 focus-visible:outline-none"
                    />

                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy || noteTooShort}
                        onClick={() => decide(row, "decline")}
                        className="bg-red-700 text-white hover:bg-red-700/90"
                      >
                        {busy ? "Declining..." : "Decline it"}
                      </Button>

                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          setDecliningId(null);
                          setNote("");
                        }}
                      >
                        Cancel
                      </Button>

                      {noteTooShort && (
                        <span className="text-xs text-neutral-500">
                          At least {MIN_DECISION_NOTE_LENGTH} characters.
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    {mayApprove ? (
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        onClick={() => decide(row, "approve")}
                        className="bg-campfire text-white hover:bg-campfire/90"
                      >
                        {busy ? "Approving..." : "Approve"}
                      </Button>
                    ) : (
                      <span className="text-sm text-neutral-600">
                        Only an administrator can approve a cancellation,
                        because it takes the pledge off the public total.
                      </span>
                    )}

                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setDecliningId(row.id);
                        setNote("");
                      }}
                    >
                      Decline
                    </Button>
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
