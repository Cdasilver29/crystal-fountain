"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatKES, groupDigits } from "@/lib/format";
import { redemptionSummary } from "@/lib/redemption";
import {
  adminCreatePledgeInput,
  PLEDGE_CATEGORIES,
  REDEMPTION_CHOICES,
  REDEMPTION_PLANS,
  type PledgeCategory,
  type PledgeTier,
  type RedemptionChoice,
} from "@/server/contracts/pledges";

/**
 * The treasurer recording a pledge made on paper or over the phone.
 *
 * Verified on entry, so it counts the moment it is saved. The bot check and the
 * auto approve limit are the public form's way of approximating a person
 * deciding they believe a pledge, and here there is an actual person doing it.
 *
 * The consents are asked as questions about what the pledger said, not as boxes
 * the treasurer ticks on their behalf. Somebody who filled in a paper card
 * either agreed to be named or did not, and guessing is how a promise made at
 * the moment of consent gets broken later.
 *
 * A second entry for a phone number that already has a pledge adds to it, the
 * same as the public form, and the screen says so afterwards rather than
 * pretending a new reference was made.
 */

const CHANNELS = ["admin", "event", "sms", "import"] as const;

export function PledgeRecordForm() {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [membershipNo, setMembershipNo] = useState("");
  const [digits, setDigits] = useState("");
  const [category, setCategory] = useState<PledgeCategory | "">("");
  const [tier, setTier] = useState<PledgeTier | "">("");
  const [redemption, setRedemption] = useState<RedemptionChoice>("one_off");
  const [channel, setChannel] =
    useState<(typeof CHANNELS)[number]>("admin");
  const [note, setNote] = useState("");
  const [contactConsent, setContactConsent] = useState(false);
  const [displayConsent, setDisplayConsent] = useState(false);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{
    reference: string;
    amountMinor: string;
    isAddition: boolean;
  } | null>(null);

  const breakdown =
    digits === ""
      ? null
      : redemptionSummary(BigInt(digits) * 100n, redemption);

  function reset() {
    setFullName("");
    setPhone("");
    setEmail("");
    setMembershipNo("");
    setDigits("");
    setCategory("");
    setTier("");
    setRedemption("one_off");
    setNote("");
    setContactConsent(false);
    setDisplayConsent(false);
    setErrors({});
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    const parsed = adminCreatePledgeInput.safeParse({
      fullName,
      phone,
      email,
      membershipNo,
      amountKes: digits === "" ? Number.NaN : Number(digits),
      installmentFrequency: redemption === "one_off" ? undefined : redemption,
      category: category || undefined,
      tier: tier || undefined,
      channel,
      note,
      contactConsent,
      displayConsent,
    });

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
      const response = await fetch("/api/admin/pledges", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setErrors(
          body?.errors ?? {
            form: body?.title ?? "We could not record that pledge.",
          },
        );
        setBusy(false);
        return;
      }

      setDone({
        reference: String(body.reference),
        amountMinor: String(body.amountMinor),
        isAddition: Boolean(body.isAddition),
      });
      reset();
      setBusy(false);
    } catch {
      setErrors({
        form: "We could not reach the server. Check your connection.",
      });
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {done && (
        <div
          role="status"
          className="rounded-xl border border-campfire/30 bg-campfire/5 p-4"
        >
          <p className="font-semibold text-navy">
            {done.isAddition
              ? `Added to ${done.reference}`
              : `Recorded as ${done.reference}`}
          </p>
          <p className="tabular mt-1 text-sm text-neutral-700">
            {done.isAddition
              ? `That number already had a pledge, so the amount was added to it. It now stands at ${formatKES(done.amountMinor)}.`
              : `${formatKES(done.amountMinor)}, confirmed and counting toward the total.`}
          </p>
        </div>
      )}

      {errors.form && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {errors.form}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="rec-name" label="Full name" error={errors.fullName} required>
          <Input
            id="rec-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </Field>

        <Field
          id="rec-phone"
          label="Phone number"
          error={errors.phone}
          hint="The identity key. A second pledge from this number adds to the first."
          required
        >
          <Input
            id="rec-phone"
            value={phone}
            inputMode="tel"
            placeholder="0712 345 678"
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>

        <Field id="rec-email" label="Email address" error={errors.email}>
          <Input
            id="rec-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        <Field
          id="rec-membership"
          label="Membership number"
          error={errors.membershipNo}
        >
          <Input
            id="rec-membership"
            value={membershipNo}
            onChange={(e) => setMembershipNo(e.target.value)}
          />
        </Field>
      </div>

      <Field
        id="rec-amount"
        label="Amount in shillings"
        error={errors.amountKes}
        required
      >
        <Input
          id="rec-amount"
          inputMode="numeric"
          value={groupDigits(digits)}
          onChange={(e) =>
            setDigits(e.target.value.replace(/\D/g, "").slice(0, 10))
          }
          className="tabular"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="rec-category" label="Pledging as">
          <select
            id="rec-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as PledgeCategory | "")}
            className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-navy focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
          >
            <option value="">Not recorded</option>
            {PLEDGE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c === "family" ? "Family or group" : "Individual"}
              </option>
            ))}
          </select>
        </Field>

        <Field id="rec-plan" label="Redemption plan">
          <select
            id="rec-plan"
            value={redemption}
            onChange={(e) => setRedemption(e.target.value as RedemptionChoice)}
            className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-navy focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
          >
            {REDEMPTION_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {REDEMPTION_PLANS[choice].label}
              </option>
            ))}
          </select>
        </Field>

        <Field id="rec-channel" label="How it arrived">
          <select
            id="rec-channel"
            value={channel}
            onChange={(e) =>
              setChannel(e.target.value as (typeof CHANNELS)[number])
            }
            className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-navy focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
          >
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {breakdown && (
        <p className="tabular rounded-lg bg-denim/5 px-3 py-2 text-sm text-navy">
          {breakdown}
        </p>
      )}

      <Field id="rec-note" label="Note" error={errors.note}>
        <Input
          id="rec-note"
          value={note}
          placeholder="Pledge card handed in at the 9am service"
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>

      <fieldset className="rounded-xl border border-neutral-200 p-4">
        <legend className="px-1 text-sm font-medium text-navy">
          What they agreed to
        </legend>
        <p className="mt-1 text-sm text-neutral-600">
          Tick only what the pledger actually said. These decide whether they can
          be contacted and whether their first name appears publicly.
        </p>

        <label className="mt-3 flex items-start gap-3 text-sm text-neutral-800">
          <input
            type="checkbox"
            checked={contactConsent}
            onChange={(e) => setContactConsent(e.target.checked)}
            className="mt-0.5 size-4 rounded border-neutral-300"
          />
          They may be contacted about this pledge and how to pay it.
        </label>

        <label className="mt-2.5 flex items-start gap-3 text-sm text-neutral-800">
          <input
            type="checkbox"
            checked={displayConsent}
            onChange={(e) => setDisplayConsent(e.target.checked)}
            className="mt-0.5 size-4 rounded border-neutral-300"
          />
          Their first name and pledge amount may appear in the recent pledges
          feed on the website.
        </label>
      </fieldset>

      <Button type="submit" disabled={busy}>
        {busy ? "Recording" : "Record pledge"}
      </Button>
    </form>
  );
}

function Field({
  id,
  label,
  error,
  hint,
  required = false,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={id}>
        {label}
        {!required && (
          <span className="ml-1 font-normal text-neutral-400">(optional)</span>
        )}
      </Label>
      <div className="mt-2">{children}</div>
      {hint && !error && (
        <p className="mt-1 text-xs text-neutral-500">{hint}</p>
      )}
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  );
}
