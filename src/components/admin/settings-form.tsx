"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatKES, groupDigits } from "@/lib/format";
import { campaignSettingsInput } from "@/server/contracts/campaign";

/**
 * The campaign settings.
 *
 * Split into two halves that behave differently on purpose. The figures at the
 * top move what every public page says; the payment details at the bottom
 * decide where the congregation's money is actually sent, and a mistyped digit
 * there sends real giving to the wrong account with no deploy and no review to
 * catch it. So that half asks again before saving and shows exactly what is
 * about to change.
 *
 * Only what moved is sent, so a save that touches nothing writes nothing.
 */

export type Settings = {
  targetMinor: string;
  openingBalanceMinor: string;
  autoApproveLimitMinor: string | null;
  isPublic: boolean;
  mpesaPaybill: string | null;
  mpesaAccountName: string | null;
  bankName: string | null;
  bankBranch: string | null;
  bankAccountName: string | null;
  bankAccount: string | null;
  bankSwift: string | null;
  bankBranchCode: string | null;
};

const PAYMENT_FIELDS = [
  ["mpesaPaybill", "M-Pesa business number"],
  ["mpesaAccountName", "M-Pesa account name"],
  ["bankAccountName", "Bank account name"],
  ["bankName", "Bank"],
  ["bankBranch", "Branch"],
  ["bankAccount", "Bank account number"],
  ["bankSwift", "Swift code"],
  ["bankBranchCode", "Branch code"],
] as const;

type PaymentField = (typeof PAYMENT_FIELDS)[number][0];

export function SettingsForm({
  settings,
  fallbacks,
}: {
  settings: Settings;
  /** What each payment field falls back to when it is left empty. */
  fallbacks: Record<PaymentField, string>;
}) {
  const router = useRouter();

  const toKes = (minor: string | null) =>
    minor === null ? "" : (BigInt(minor) / 100n).toString();

  const [target, setTarget] = useState(toKes(settings.targetMinor));
  const [opening, setOpening] = useState(toKes(settings.openingBalanceMinor));
  const [limit, setLimit] = useState(toKes(settings.autoApproveLimitMinor));
  const [isPublic, setIsPublic] = useState(settings.isPublic);
  const [payment, setPayment] = useState<Record<PaymentField, string>>(() => {
    const initial = {} as Record<PaymentField, string>;
    for (const [field] of PAYMENT_FIELDS) initial[field] = settings[field] ?? "";
    return initial;
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string[] | null>(null);
  const [confirming, setConfirming] = useState(false);

  /** Exactly what is about to change, named the way the journal will name it. */
  function diff() {
    const payload: Record<string, unknown> = {};

    if (target !== toKes(settings.targetMinor) && target !== "") {
      payload.targetKes = Number(target);
    }
    if (opening !== toKes(settings.openingBalanceMinor) && opening !== "") {
      payload.openingBalanceKes = Number(opening);
    }
    if (limit !== toKes(settings.autoApproveLimitMinor)) {
      payload.autoApproveLimitKes = limit === "" ? null : Number(limit);
    }
    if (isPublic !== settings.isPublic) payload.isPublic = isPublic;

    for (const [field] of PAYMENT_FIELDS) {
      if (payment[field] !== (settings[field] ?? "")) {
        payload[field] = payment[field];
      }
    }

    return payload;
  }

  const pending = diff();
  const touchesPayments = PAYMENT_FIELDS.some(([f]) => f in pending);
  const nothingToDo = Object.keys(pending).length === 0;

  async function save() {
    const parsed = campaignSettingsInput.safeParse(pending);

    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      setConfirming(false);
      return;
    }

    setErrors({});
    setBusy(true);

    try {
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setErrors(
          body?.errors ?? {
            form: body?.title ?? "We could not save those settings.",
          },
        );
        setBusy(false);
        setConfirming(false);
        return;
      }

      setSaved((body?.changed as string[]) ?? []);
      setBusy(false);
      setConfirming(false);
      router.refresh();
    } catch {
      setErrors({
        form: "We could not reach the server. Check your connection.",
      });
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (nothingToDo) return;
        // Changing where money goes asks twice. Changing the target does not:
        // it is visible, reversible and hurts nobody's giving.
        if (touchesPayments && !confirming) {
          setConfirming(true);
          return;
        }
        save();
      }}
      className="space-y-8"
    >
      {saved && (
        <p
          role="status"
          className="rounded-lg border border-campfire/30 bg-campfire/5 px-4 py-3 text-sm text-navy"
        >
          {saved.length === 0
            ? "Nothing had changed, so nothing was saved."
            : `Saved. Changed: ${saved.join(", ")}.`}
        </p>
      )}

      {errors.form && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {errors.form}
        </p>
      )}

      <section className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="font-semibold text-navy">The campaign</h2>
        <p className="mt-1 text-sm text-neutral-600">
          The target and the opening balance are both inside the figure on every
          public page, so changing either moves what the congregation sees.
        </p>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div>
            <Label htmlFor="target">Target in shillings</Label>
            <Input
              id="target"
              inputMode="numeric"
              value={groupDigits(target)}
              onChange={(e) =>
                setTarget(e.target.value.replace(/\D/g, "").slice(0, 13))
              }
              className="tabular mt-2"
            />
            <p className="mt-1 text-xs text-neutral-500">
              Currently {formatKES(settings.targetMinor)}.
            </p>
            {errors.targetKes && (
              <p className="mt-1 text-sm text-red-700">{errors.targetKes}</p>
            )}
          </div>

          <div>
            <Label htmlFor="opening">Opening balance in shillings</Label>
            <Input
              id="opening"
              inputMode="numeric"
              value={groupDigits(opening)}
              onChange={(e) =>
                setOpening(e.target.value.replace(/\D/g, "").slice(0, 13))
              }
              className="tabular mt-2"
            />
            <p className="mt-1 text-xs text-neutral-500">
              Money raised before this platform existed. It is added to both the
              pledged and the received figures.
            </p>
            {errors.openingBalanceKes && (
              <p className="mt-1 text-sm text-red-700">
                {errors.openingBalanceKes}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="limit">Auto approve limit in shillings</Label>
            <Input
              id="limit"
              inputMode="numeric"
              value={groupDigits(limit)}
              placeholder="Leave empty for the default"
              onChange={(e) =>
                setLimit(e.target.value.replace(/\D/g, "").slice(0, 13))
              }
              className="tabular mt-2"
            />
            <p className="mt-1 text-xs text-neutral-500">
              A pledge whose total lands under this is confirmed on submission.
              Anything at or above it waits for the treasurer. Empty falls back
              to the value set in the environment.
            </p>
            {errors.autoApproveLimitKes && (
              <p className="mt-1 text-sm text-red-700">
                {errors.autoApproveLimitKes}
              </p>
            )}
          </div>

          <div>
            <span className="text-sm font-medium text-navy">Pledging</span>
            <label className="mt-2 flex items-start gap-3 text-sm text-neutral-800">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="mt-0.5 size-4 rounded border-neutral-300"
              />
              The pledge form is open to the public.
            </label>
            <p className="mt-1 text-xs text-neutral-500">
              Unticked, the form refuses new pledges and says so. The figures
              stay visible either way: they are already public, and making them
              vanish mid campaign would alarm people watching them.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-denim/25 bg-denim/5 p-5 sm:p-6">
        <h2 className="font-semibold text-navy">Where the money is sent</h2>
        <p className="mt-1 text-sm leading-relaxed text-neutral-700">
          These appear on every page that tells somebody how to give. A wrong
          digit here sends real money to the wrong account, so read them back
          before saving. Leave a box empty to use the value built into the site.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {PAYMENT_FIELDS.map(([field, label]) => (
            <div key={field}>
              <Label htmlFor={field}>{label}</Label>
              <Input
                id={field}
                value={payment[field]}
                placeholder={fallbacks[field]}
                onChange={(e) =>
                  setPayment((p) => ({ ...p, [field]: e.target.value }))
                }
                className="tabular mt-2 bg-white"
              />
              {errors[field] && (
                <p className="mt-1 text-sm text-red-700">{errors[field]}</p>
              )}
            </div>
          ))}
        </div>
      </section>

      {confirming && (
        <div
          role="status"
          className="rounded-2xl border border-red-200 bg-red-50 p-5"
        >
          <h2 className="font-semibold text-red-900">
            You are changing where money is sent. Read this back.
          </h2>
          <ul className="mt-3 space-y-1 text-sm text-red-900/90">
            {PAYMENT_FIELDS.filter(([f]) => f in pending).map(
              ([field, label]) => (
                <li key={field} className="tabular">
                  {label}:{" "}
                  <span className="line-through opacity-70">
                    {settings[field] ?? fallbacks[field]}
                  </span>{" "}
                  &rarr;{" "}
                  <span className="font-semibold">
                    {payment[field] || fallbacks[field]}
                  </span>
                </li>
              ),
            )}
          </ul>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none disabled:opacity-60"
            >
              {busy ? "Saving" : "Yes, these are correct"}
            </button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming(false)}
              disabled={busy}
            >
              Let me check again
            </Button>
          </div>
        </div>
      )}

      {!confirming && (
        <Button type="submit" disabled={busy || nothingToDo}>
          {busy
            ? "Saving"
            : nothingToDo
              ? "Nothing to save"
              : touchesPayments
                ? "Review and save"
                : "Save settings"}
        </Button>
      )}
    </form>
  );
}
