"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatKES, groupDigits } from "@/lib/format";
import { redemptionSummary } from "@/lib/redemption";
import {
  editPledgeInput,
  PLEDGE_STATUSES,
  REDEMPTION_CHOICES,
  REDEMPTION_PLANS,
  type PledgeStatus,
  type RedemptionChoice,
} from "@/server/contracts/pledges";

/**
 * Correcting a pledge, in place on the detail screen.
 *
 * The amount asks for a reason and will not save without one. A figure the
 * congregation can see moving is the one write where the number alone is not
 * enough of a record, and the database agrees: the adjustment increment behind
 * this carries a check constraint that refuses a reasonless correction.
 *
 * The reference, the public token, the name and the phone number are shown but
 * not editable and are not even sent. The reference is printed on somebody's
 * confirmation, the token is in their QR code, and the phone number is what
 * accumulation keys on.
 *
 * Only what actually changed is sent, so a save that touches nothing is a save
 * that writes nothing, rather than an audit row saying a field was set to the
 * value it already had.
 */

export type EditablePledge = {
  id: string;
  amountMinor: string;
  status: PledgeStatus;
  installmentFrequency: string | null;
  note: string | null;
};

export function PledgeEdit({ pledge }: { pledge: EditablePledge }) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [digits, setDigits] = useState(
    (BigInt(pledge.amountMinor) / 100n).toString(),
  );
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<PledgeStatus>(pledge.status);
  const [redemption, setRedemption] = useState<RedemptionChoice>(
    (pledge.installmentFrequency as RedemptionChoice | null) ?? "one_off",
  );
  const [note, setNote] = useState(pledge.note ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const originalKes = (BigInt(pledge.amountMinor) / 100n).toString();
  const amountChanged = digits !== originalKes && digits !== "";
  const targetMinor = digits === "" ? 0n : BigInt(digits) * 100n;
  const delta = targetMinor - BigInt(pledge.amountMinor);

  const breakdown =
    digits === "" ? null : redemptionSummary(targetMinor, redemption);

  function reset() {
    setDigits(originalKes);
    setReason("");
    setStatus(pledge.status);
    setRedemption(
      (pledge.installmentFrequency as RedemptionChoice | null) ?? "one_off",
    );
    setNote(pledge.note ?? "");
    setErrors({});
    setOpen(false);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();

    // Only what moved. A field that did not change is left out entirely, so
    // the audit row records a correction rather than a restatement.
    const payload: Record<string, unknown> = {};

    if (amountChanged) {
      payload.amountKes = Number(digits);
      payload.reason = reason;
    }
    if (status !== pledge.status) payload.status = status;
    if (
      redemption !==
      ((pledge.installmentFrequency as RedemptionChoice | null) ?? "one_off")
    ) {
      payload.installmentFrequency = redemption;
    }
    if (note !== (pledge.note ?? "")) payload.note = note;

    if (Object.keys(payload).length === 0) {
      setOpen(false);
      return;
    }

    const parsed = editPledgeInput.safeParse(payload);

    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }

    setErrors({});
    setBusy(true);

    try {
      const response = await fetch(`/api/admin/pledges/${pledge.id}/edit`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setErrors(
          body?.errors ?? {
            form: body?.title ?? "We could not save that correction.",
          },
        );
        setBusy(false);
        return;
      }

      setOpen(false);
      setBusy(false);
      setReason("");
      router.refresh();
    } catch {
      setErrors({
        form: "We could not reach the server. Check your connection.",
      });
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        Edit pledge
      </Button>
    );
  }

  return (
    <form
      onSubmit={save}
      className="rounded-2xl border border-campfire/30 bg-campfire/5 p-5"
    >
      <h2 className="font-semibold text-navy">Correct this pledge</h2>

      {errors.form && (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {errors.form}
        </p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="edit-amount">Amount in shillings</Label>
          <Input
            id="edit-amount"
            inputMode="numeric"
            value={groupDigits(digits)}
            onChange={(e) =>
              setDigits(e.target.value.replace(/\D/g, "").slice(0, 10))
            }
            className="tabular mt-2"
          />
          {errors.amountKes && (
            <p className="mt-1 text-sm text-red-700">{errors.amountKes}</p>
          )}
          {amountChanged && (
            <p className="tabular mt-1.5 text-sm text-navy">
              {delta > 0n ? "Adds " : "Takes off "}
              <span className="font-semibold">
                {formatKES(delta < 0n ? -delta : delta)}
              </span>{" "}
              as a correction row. The original submissions stay as they are.
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="edit-status">Status</Label>
          <select
            id="edit-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as PledgeStatus)}
            className="mt-2 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-navy focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
          >
            {PLEDGE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {amountChanged && (
        <div className="mt-4">
          <Label htmlFor="edit-reason">Why the amount changed</Label>
          <Input
            id="edit-reason"
            value={reason}
            placeholder="Treasurer confirmed the pledge card says 4,200,000"
            onChange={(e) => setReason(e.target.value)}
            className="mt-2"
          />
          {errors.reason && (
            <p className="mt-1 text-sm text-red-700">{errors.reason}</p>
          )}
        </div>
      )}

      <div className="mt-4">
        <Label htmlFor="edit-plan">Redemption plan</Label>
        <select
          id="edit-plan"
          value={redemption}
          onChange={(e) => setRedemption(e.target.value as RedemptionChoice)}
          className="mt-2 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-navy focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
        >
          {REDEMPTION_CHOICES.map((choice) => (
            <option key={choice} value={choice}>
              {REDEMPTION_PLANS[choice].label}
            </option>
          ))}
        </select>
        {breakdown && (
          <p className="tabular mt-2 rounded-lg bg-white px-3 py-2 text-sm text-navy">
            {breakdown}
          </p>
        )}
      </div>

      <div className="mt-4">
        <Label htmlFor="edit-note">Note</Label>
        <Input
          id="edit-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="mt-2"
        />
        {errors.note && (
          <p className="mt-1 text-sm text-red-700">{errors.note}</p>
        )}
      </div>

      <div className="mt-5 flex items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving" : "Save correction"}
        </Button>
        <Button type="button" variant="outline" onClick={reset} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
