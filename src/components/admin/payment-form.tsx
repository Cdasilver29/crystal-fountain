"use client";

import Link from "next/link";
import { useState } from "react";

import { groupDigits } from "@/lib/format";
import {
  METHODS_REQUIRING_REFERENCE,
  PAYMENT_METHODS,
  recordPaymentInput,
  type PaymentMethod,
} from "@/server/contracts/payments";

/**
 * Recording a payment.
 *
 * The same schema that guards the endpoint runs here first, so a mistake is
 * caught before a round trip. That is convenience only: the server parses the
 * body again and is the thing that decides, per CLAUDE.md.
 *
 * The amount field copies the pledge form deliberately. It is the field most
 * likely to be typed wrong, and the treasurer should meet the same grouped
 * digits and the same numeric keypad in both places.
 */

type Errors = Record<string, string>;

const METHOD_LABELS: Record<PaymentMethod, string> = {
  mpesa: "M-Pesa",
  bank: "Bank transfer",
  cash: "Cash",
  cheque: "Cheque",
  other: "Other",
};

/** Today in Nairobi, as the date input wants it. */
function today(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });
}

export function PaymentForm() {
  const [method, setMethod] = useState<PaymentMethod>("mpesa");
  const [externalRef, setExternalRef] = useState("");
  const [amountDigits, setAmountDigits] = useState("");
  const [payerName, setPayerName] = useState("");
  const [payerPhone, setPayerPhone] = useState("");
  const [accountRef, setAccountRef] = useState("");
  const [paidAt, setPaidAt] = useState(today());
  const [note, setNote] = useState("");

  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recorded, setRecorded] = useState<{
    paymentId: string;
    amountMinor: string;
  } | null>(null);

  const refRequired = METHODS_REQUIRING_REFERENCE.includes(method);

  function reset() {
    setMethod("mpesa");
    setExternalRef("");
    setAmountDigits("");
    setPayerName("");
    setPayerPhone("");
    setAccountRef("");
    setPaidAt(today());
    setNote("");
    setErrors({});
    setFormError(null);
    setRecorded(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    setErrors({});

    const payload = {
      method,
      externalRef,
      amountKes: amountDigits === "" ? Number.NaN : Number(amountDigits),
      payerName,
      payerPhone,
      accountRef,
      paidAt,
      note,
    };

    const parsed = recordPaymentInput.safeParse(payload);

    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      setBusy(false);
      return;
    }

    try {
      const response = await fetch("/api/admin/payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        if (body?.errors) setErrors(body.errors);
        else setFormError(body?.title ?? "That did not work.");
        setBusy(false);
        return;
      }

      setRecorded({
        paymentId: body.paymentId,
        amountMinor: body.amountMinor,
      });
      setBusy(false);
    } catch {
      setFormError("Could not reach the server. Check your connection.");
      setBusy(false);
    }
  }

  if (recorded) {
    return (
      <div className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold text-navy">Payment recorded</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-700">
          {formatMinor(recorded.amountMinor)} is now counted toward the campaign
          total. It is not yet matched to a pledge.
        </p>

        <dl className="mt-4 border-t border-neutral-100 pt-4 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-neutral-500">Payment id</dt>
            <dd className="tabular font-medium break-all text-navy select-all">
              {recorded.paymentId}
            </dd>
          </div>
        </dl>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-11 cursor-pointer items-center justify-center rounded-lg bg-campfire px-6 text-base font-semibold text-white transition-colors hover:bg-[#ef7433] focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Record another
          </button>
          <Link
            href="/admin/pledges"
            className="inline-flex h-11 items-center justify-center rounded-lg border border-neutral-300 px-6 text-base font-medium text-navy transition-colors hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
          >
            Back to pledges
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm sm:p-8"
    >
      <div className="space-y-5">
        <div>
          <label htmlFor="method" className="block text-sm font-medium text-navy">
            How the money arrived
          </label>
          <select
            id="method"
            value={method}
            onChange={(event) => setMethod(event.target.value as PaymentMethod)}
            className="mt-1.5 h-11 w-full cursor-pointer rounded-lg border border-neutral-300 bg-white px-3 text-base text-navy focus-visible:border-campfire focus-visible:ring-2 focus-visible:ring-campfire/40 focus-visible:outline-none"
          >
            {PAYMENT_METHODS.map((value) => (
              <option key={value} value={value}>
                {METHOD_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <Field
          id="externalRef"
          label={
            method === "mpesa"
              ? "M-Pesa receipt number"
              : method === "bank"
                ? "Bank slip number"
                : "Reference"
          }
          value={externalRef}
          onChange={setExternalRef}
          error={errors.externalRef}
          hint={
            refRequired
              ? "Required. This is what stops the same payment being entered twice."
              : "Optional."
          }
          // M-Pesa receipts are upper case, and so is what gets stored.
          className="uppercase"
          autoComplete="off"
        />

        <div>
          <label htmlFor="amount" className="block text-sm font-medium text-navy">
            Amount in Kenyan shillings
          </label>
          <div className="mt-1.5 flex items-baseline gap-2 border-b-2 border-neutral-200 pb-2 has-[:focus-visible]:border-campfire">
            <span className="text-xl font-medium text-neutral-400">KES</span>
            <input
              id="amount"
              // type="text" with inputMode numeric gives the numeric keypad
              // while still allowing grouped digits. type "number" would forbid
              // the separators and add spinners.
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              placeholder="0"
              aria-invalid={errors.amountKes ? true : undefined}
              aria-describedby={errors.amountKes ? "amount-error" : undefined}
              value={groupDigits(amountDigits)}
              onChange={(event) =>
                setAmountDigits(event.target.value.replace(/\D/g, "").slice(0, 9))
              }
              className="tabular w-full min-w-0 rounded bg-transparent text-3xl font-semibold tracking-tight text-navy outline-none placeholder:text-neutral-300 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
            />
          </div>
          {errors.amountKes && (
            <p id="amount-error" role="alert" className="mt-1 text-sm text-red-700">
              {errors.amountKes}
            </p>
          )}
        </div>

        <Field
          id="payerName"
          label="Payer name"
          value={payerName}
          onChange={setPayerName}
          error={errors.payerName}
          hint="As the channel reported it, not as you would write it."
          autoComplete="off"
        />

        <Field
          id="payerPhone"
          label="Payer phone"
          value={payerPhone}
          onChange={setPayerPhone}
          error={errors.payerPhone}
          hint="Optional. A bank slip will not have one."
          inputMode="tel"
          autoComplete="off"
        />

        <Field
          id="accountRef"
          label="Account reference"
          value={accountRef}
          onChange={setAccountRef}
          error={errors.accountRef}
          hint="What the payer typed as the account number. Used to match this to a pledge."
          className="uppercase"
          autoComplete="off"
        />

        <div>
          <label htmlFor="paidAt" className="block text-sm font-medium text-navy">
            Date paid
          </label>
          <input
            id="paidAt"
            type="date"
            value={paidAt}
            max={today()}
            onChange={(event) => setPaidAt(event.target.value)}
            aria-invalid={errors.paidAt ? true : undefined}
            aria-describedby={errors.paidAt ? "paidAt-error" : undefined}
            className="tabular mt-1.5 h-11 w-full rounded-lg border border-neutral-300 px-3 text-base text-navy focus-visible:border-campfire focus-visible:ring-2 focus-visible:ring-campfire/40 focus-visible:outline-none"
          />
          {errors.paidAt && (
            <p id="paidAt-error" role="alert" className="mt-1 text-sm text-red-700">
              {errors.paidAt}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="note" className="block text-sm font-medium text-navy">
            Note
          </label>
          <textarea
            id="note"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            aria-invalid={errors.note ? true : undefined}
            className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-base text-navy focus-visible:border-campfire focus-visible:ring-2 focus-visible:ring-campfire/40 focus-visible:outline-none"
          />
          {errors.note && (
            <p role="alert" className="mt-1 text-sm text-red-700">
              {errors.note}
            </p>
          )}
        </div>
      </div>

      {formError && (
        <p
          role="alert"
          className="mt-5 rounded-lg bg-red-50 px-3 py-2 text-sm leading-relaxed text-red-800"
        >
          {formError}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="mt-7 inline-flex h-11 w-full cursor-pointer items-center justify-center rounded-lg bg-campfire px-6 text-base font-semibold text-white transition-colors hover:bg-[#ef7433] focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {busy ? "Recording" : "Record payment"}
      </button>
    </form>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  className,
  inputMode,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  className?: string;
  inputMode?: "tel" | "text";
  autoComplete?: string;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-navy">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode={inputMode}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`mt-1.5 h-11 w-full rounded-lg border border-neutral-300 px-3 text-base text-navy focus-visible:border-campfire focus-visible:ring-2 focus-visible:ring-campfire/40 focus-visible:outline-none aria-[invalid]:border-red-400 ${className ?? ""}`}
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-red-700">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-sm text-neutral-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Minor units as shillings. The value arrives as a string and stays exact. */
function formatMinor(minor: string): string {
  const kes = BigInt(minor) / 100n;
  return `KES ${kes.toLocaleString("en-KE")}`;
}
