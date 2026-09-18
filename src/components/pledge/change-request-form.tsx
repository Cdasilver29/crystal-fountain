"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectField } from "@/components/ui/select-field";
import { CONTACT } from "@/content/campaign";
import { formatDate, formatKES, groupDigits } from "@/lib/format";
import {
  CHANGE_REQUEST_KINDS,
  CHANGE_REQUEST_LABELS,
  changeRequestInput,
  reduceAmountRefusal,
  type ChangeRequestKind,
} from "@/server/contracts/change-requests";
import { REDEMPTION_CHOICES, REDEMPTION_PLANS } from "@/server/contracts/pledges";

/**
 * Asking for something to be changed about your own pledge.
 *
 * Everything the pledge form cannot do on its own. Increasing is not here and
 * says so in as many words, because the pledge form already adds to an
 * existing pledge from the same number without anybody's approval, and sending
 * somebody through a queue for it would be slower for them and more work for
 * the treasurer.
 *
 * One kind at a time, chosen first, because the five ask for completely
 * different things and a form showing all of their fields at once would be a
 * wall nobody reads. The same contract that guards the endpoint runs here
 * first, so a mistake is caught before a round trip; that is convenience only,
 * and the server parses the body again and is the thing that decides.
 *
 * Nothing this form does changes the pledge. It writes a question down. The
 * copy says so more than once, because somebody who submits a reduction and
 * then sees their old figure on the screen would otherwise think it failed.
 */

/** What the pledge currently says, for the fields that need to show it. */
export type PledgeNow = {
  reference: string;
  amountMinor: string;
  installmentFrequency: string | null;
};

type Errors = Record<string, string>;

const KIND_HINTS: Record<ChangeRequestKind, string> = {
  reduce_amount:
    "Ask for your pledge to be lowered. The treasurer will look at it and decide.",
  change_plan: "Ask to pay over a different schedule. The total stays the same.",
  correct_name: "Correct a misspelling, or a name that has changed.",
  payment_missing:
    "Tell the treasurer about money you have paid that is not showing against your pledge.",
  cancel_pledge:
    "Ask for the whole pledge to be withdrawn. An administrator decides this one.",
};

/** Today in Nairobi, as the date input wants it. */
function today(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });
}

function planLabel(frequency: string | null): string {
  if (!frequency || frequency === "one_off") return "one payment";
  return REDEMPTION_PLANS[frequency as keyof typeof REDEMPTION_PLANS].label;
}

export function ChangeRequestForm({
  pledge,
  phone,
  onRaised,
}: {
  pledge: PledgeNow;
  /** The number already proved against this reference by the lookup. */
  phone: string;
  /** Lets the panel above swap the form for the pending state. */
  onRaised: (raised: { kind: ChangeRequestKind; createdAt: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ChangeRequestKind>("reduce_amount");
  const [amountDigits, setAmountDigits] = useState("");
  const [frequency, setFrequency] = useState<string>(
    pledge.installmentFrequency ?? "one_off",
  );
  const [name, setName] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paidDigits, setPaidDigits] = useState("");
  const [paidOn, setPaidOn] = useState(today());
  const [reason, setReason] = useState("");

  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** What this form will post, before the contract has looked at it. */
  function payload(): Record<string, unknown> {
    const base = { kind, reference: pledge.reference, contactPhoneE164: phone, reason };

    switch (kind) {
      case "reduce_amount":
        return {
          ...base,
          // Shillings on the screen, minor units on the wire, as a string so
          // nothing here turns money into a JavaScript number.
          requestedAmountMinor: amountDigits ? `${amountDigits}00` : "",
        };
      case "change_plan":
        return { ...base, requestedFrequency: frequency };
      case "correct_name":
        return { ...base, requestedName: name };
      case "payment_missing":
        return {
          ...base,
          paymentReference,
          paymentAmountMinor: paidDigits ? `${paidDigits}00` : "",
          paymentPaidOn: paidOn,
        };
      case "cancel_pledge":
        return base;
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    const parsed = changeRequestInput.safeParse(payload());

    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }

    /*
     * The less than rule, checked here as well as in the service. It compares
     * what was typed against what the pledge currently holds, which the schema
     * has no way to know, and catching it before a round trip is the
     * difference between a sentence under the field and a refusal from the
     * server.
     */
    if (parsed.data.kind === "reduce_amount") {
      const refusal = reduceAmountRefusal(
        parsed.data.requestedAmountMinor,
        BigInt(pledge.amountMinor),
      );
      if (refusal) {
        setErrors({ requestedAmountMinor: refusal });
        return;
      }
    }

    setErrors({});
    setBusy(true);

    try {
      const response = await fetch("/api/redeem/change-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        if (body?.errors) {
          setErrors(body.errors);
        } else {
          setFormError(
            body?.title ??
              "We could not send that just now. Please try again in a moment.",
          );
        }
        setBusy(false);
        return;
      }

      /*
       * "already_pending" is not an error. Somebody who submitted twice sees
       * the request they already have, which is what the pending state above
       * is for.
       */
      onRaised({ kind: body.request.kind, createdAt: body.request.createdAt });
    } catch {
      setFormError("We could not reach the server. Check your connection.");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-5 border-t border-neutral-100 pt-5">
        <p className="text-sm leading-relaxed text-neutral-600">
          Need something changed about this pledge? You can ask the treasurer to
          lower it, change how you are paying, correct your name, or look into a
          payment that is not showing.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 rounded text-sm font-medium text-denim underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
        >
          Ask for a change
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="mt-5 rounded-xl border border-neutral-200 bg-neutral-50 p-4 sm:p-5"
    >
      <h3 className="font-semibold text-navy">Ask for a change</h3>

      <p className="mt-1 text-sm leading-relaxed text-neutral-600">
        This does not change your pledge. It sends a note to the treasurer, who
        decides and lets you know.
      </p>

      {formError && (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {formError}
        </p>
      )}

      <div className="mt-4">
        <Label htmlFor="request-kind">What would you like changed?</Label>
        <SelectField
          id="request-kind"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as ChangeRequestKind);
            setErrors({});
          }}
          className="mt-2 w-full bg-white"
        >
          {CHANGE_REQUEST_KINDS.map((value) => (
            <option key={value} value={value}>
              {CHANGE_REQUEST_LABELS[value]}
            </option>
          ))}
        </SelectField>
        <p className="mt-1.5 text-sm text-neutral-600">{KIND_HINTS[kind]}</p>
      </div>

      {kind === "reduce_amount" && (
        <div className="mt-4">
          <Label htmlFor="requested-amount">
            What should it be reduced to?
          </Label>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-sm text-neutral-500">KES</span>
            <Input
              id="requested-amount"
              value={groupDigits(amountDigits)}
              inputMode="numeric"
              placeholder="300,000"
              aria-invalid={Boolean(errors.requestedAmountMinor)}
              onChange={(event) =>
                setAmountDigits(event.target.value.replace(/\D/g, ""))
              }
              className="tabular bg-white"
            />
          </div>
          <p className="mt-1.5 text-sm text-neutral-600">
            Your pledge is {formatKES(pledge.amountMinor)} at the moment. To
            increase it instead, make another pledge with this same number and
            it will be added on, with no approval needed.
          </p>
          {errors.requestedAmountMinor && (
            <p className="mt-1.5 text-sm text-red-700">
              {errors.requestedAmountMinor}
            </p>
          )}
        </div>
      )}

      {kind === "change_plan" && (
        <div className="mt-4">
          <Label htmlFor="requested-frequency">How would you like to pay?</Label>
          <SelectField
            id="requested-frequency"
            value={frequency}
            onChange={(event) => setFrequency(event.target.value)}
            className="mt-2 w-full bg-white"
          >
            {REDEMPTION_CHOICES.map((value) => (
              <option key={value} value={value}>
                {REDEMPTION_PLANS[value].label}
              </option>
            ))}
          </SelectField>
          <p className="mt-1.5 text-sm text-neutral-600">
            You are on {planLabel(pledge.installmentFrequency)} at the moment.
            The total you have pledged does not change.
          </p>
        </div>
      )}

      {kind === "correct_name" && (
        <div className="mt-4">
          <Label htmlFor="requested-name">How should your name read?</Label>
          <Input
            id="requested-name"
            value={name}
            placeholder="Jane Atieno Otieno"
            autoComplete="name"
            aria-invalid={Boolean(errors.requestedName)}
            onChange={(event) => setName(event.target.value)}
            className="mt-2 bg-white"
          />
          {errors.requestedName && (
            <p className="mt-1.5 text-sm text-red-700">{errors.requestedName}</p>
          )}
        </div>
      )}

      {kind === "payment_missing" && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="payment-reference">
              M-Pesa code or bank slip number
            </Label>
            <Input
              id="payment-reference"
              value={paymentReference}
              placeholder="QGH7X8K9LM"
              autoComplete="off"
              aria-invalid={Boolean(errors.paymentReference)}
              onChange={(event) => setPaymentReference(event.target.value)}
              className="tabular mt-2 bg-white uppercase"
            />
            {errors.paymentReference && (
              <p className="mt-1.5 text-sm text-red-700">
                {errors.paymentReference}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="paid-amount">How much did you pay?</Label>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-sm text-neutral-500">KES</span>
              <Input
                id="paid-amount"
                value={groupDigits(paidDigits)}
                inputMode="numeric"
                placeholder="50,000"
                aria-invalid={Boolean(errors.paymentAmountMinor)}
                onChange={(event) =>
                  setPaidDigits(event.target.value.replace(/\D/g, ""))
                }
                className="tabular bg-white"
              />
            </div>
            {errors.paymentAmountMinor && (
              <p className="mt-1.5 text-sm text-red-700">
                {errors.paymentAmountMinor}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="paid-on">When did you pay?</Label>
            <Input
              id="paid-on"
              type="date"
              value={paidOn}
              max={today()}
              aria-invalid={Boolean(errors.paymentPaidOn)}
              onChange={(event) => setPaidOn(event.target.value)}
              className="mt-2 bg-white"
            />
            {errors.paymentPaidOn && (
              <p className="mt-1.5 text-sm text-red-700">
                {errors.paymentPaidOn}
              </p>
            )}
          </div>
        </div>
      )}

      {kind === "cancel_pledge" && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-900">
          Cancelling takes {formatKES(pledge.amountMinor)} off the campaign
          total, so an administrator rather than the treasurer decides it. Your
          pledge stands until they do.
        </p>
      )}

      <div className="mt-4">
        <Label htmlFor="request-reason">Why, in a sentence or two</Label>
        <textarea
          id="request-reason"
          value={reason}
          rows={3}
          placeholder="My circumstances have changed since I pledged."
          aria-invalid={Boolean(errors.reason)}
          onChange={(event) => setReason(event.target.value)}
          className="mt-2 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base text-navy focus-visible:border-campfire focus-visible:ring-2 focus-visible:ring-campfire/40 focus-visible:outline-none"
        />
        <p className="mt-1.5 text-sm text-neutral-600">
          The treasurer reads this before deciding, so a line about what changed
          helps more than anything else you can write.
        </p>
        {errors.reason && (
          <p className="mt-1.5 text-sm text-red-700">{errors.reason}</p>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? "Sending…" : "Send this to the treasurer"}
        </Button>

        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setErrors({});
            setFormError(null);
          }}
        >
          Never mind
        </Button>
      </div>

      <p className="mt-3 text-sm text-neutral-600">
        In a hurry? Call {CONTACT.leaderName} on{" "}
        <a
          href={CONTACT.phoneHref}
          className="rounded text-denim underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
        >
          {CONTACT.phoneDisplay}
        </a>
        .
      </p>
    </form>
  );
}

/**
 * What replaces the form once something is already waiting.
 *
 * One open request per pledge, which the partial unique index enforces, so a
 * second form here could only ever produce a refusal. Showing what is already
 * in the queue and when it was raised answers the question somebody comes back
 * with, which is whether their first attempt went anywhere.
 */
export function ChangeRequestPending({
  request,
}: {
  request: { kind: ChangeRequestKind; createdAt: string };
}) {
  return (
    <div
      role="status"
      className="mt-5 rounded-xl border border-denim/20 bg-denim/5 px-4 py-3"
    >
      <p className="text-sm font-medium text-navy">
        {CHANGE_REQUEST_LABELS[request.kind]}: waiting for the treasurer
      </p>
      <p className="mt-1 text-sm leading-relaxed text-neutral-700">
        You asked for this on {formatDate(request.createdAt)}. Nothing has
        changed about your pledge yet, and it will not until somebody answers.
        You can only have one request open at a time, so there is nothing more
        to send.
      </p>
      <p className="mt-2 text-sm text-neutral-600">
        If it is urgent, call {CONTACT.leaderName} on{" "}
        <a
          href={CONTACT.phoneHref}
          className="rounded text-denim underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
        >
          {CONTACT.phoneDisplay}
        </a>
        .
      </p>
    </div>
  );
}
