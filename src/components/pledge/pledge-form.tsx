"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { groupDigits, formatKes, formatPhoneForDisplay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { normalizeKenyanPhone } from "@/server/contracts/phone";
import { createPledgeInput } from "@/server/contracts/pledges";

/**
 * The three step pledge form.
 *
 * Amount first, because deciding the amount is the real decision and everything
 * after it is admin. Steps are local state, not routes, so a member on a slow
 * connection never waits for a navigation between them and never loses what
 * they typed by going back.
 *
 * Validation uses the same Zod contract the route handler uses. This copy is
 * convenience only. The server revalidates everything.
 */

const QUICK_AMOUNTS = [10_000, 50_000, 100_000, 500_000, 1_000_000];

const STEP_LABELS = ["Amount", "Your details", "Review"] as const;

type Errors = Record<string, string>;

export function PledgeForm() {
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [amountDigits, setAmountDigits] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [membershipNo, setMembershipNo] = useState("");
  const [recordConsent, setRecordConsent] = useState(false);
  const [contactConsent, setContactConsent] = useState(false);
  const [displayConsent, setDisplayConsent] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

  const headingRef = useRef<HTMLHeadingElement>(null);

  const amountKes = amountDigits === "" ? Number.NaN : Number(amountDigits);

  const payload = {
    fullName,
    phone,
    email,
    membershipNo,
    amountKes,
    // The instalment toggle is hidden for now. Every pledge is one off until
    // the treasurer asks for instalments.
    intent: "one_off" as const,
    recordConsent,
    contactConsent,
    displayConsent,
  };

  function collect(issues: { path: PropertyKey[]; message: string }[]): Errors {
    const next: Errors = {};
    for (const issue of issues) {
      const key = String(issue.path[0] ?? "form");
      if (!next[key]) next[key] = issue.message;
    }
    return next;
  }

  function goTo(nextStep: number) {
    setStep(nextStep);
    setErrors({});
    // Move focus to the new step heading so a screen reader announces it and a
    // keyboard user is not left at the bottom of the page.
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  function next() {
    const fields =
      step === 0
        ? (["amountKes"] as const)
        : ([
            "fullName",
            "phone",
            "email",
            "membershipNo",
            "recordConsent",
            "contactConsent",
            "displayConsent",
          ] as const);

    const shape = Object.fromEntries(fields.map((f) => [f, true]));
    const result = createPledgeInput
      .pick(shape as Record<(typeof fields)[number], true>)
      .safeParse(payload);

    if (!result.success) {
      setErrors(collect(result.error.issues));
      return;
    }

    goTo(step + 1);
  }

  async function submit() {
    const result = createPledgeInput.safeParse(payload);

    if (!result.success) {
      setErrors(collect(result.error.issues));
      return;
    }

    setSubmitting(true);
    setErrors({});

    try {
      const response = await fetch("/api/pledges", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setErrors(
          body?.errors ?? {
            form:
              body?.title ??
              "We could not record your pledge. Please try again in a moment.",
          },
        );
        setSubmitting(false);
        return;
      }

      router.push(`/pledge/confirmed/${body.publicToken}`);
    } catch {
      setErrors({
        form: "We could not reach the server. Check your connection and try again.",
      });
      setSubmitting(false);
    }
  }

  const normalizedPhone = normalizeKenyanPhone(phone);

  return (
    <div className="mx-auto w-full max-w-lg">
      <StepIndicator step={step} />

      <div className="mt-6 rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:p-7">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-semibold tracking-tight text-navy outline-none"
        >
          {step === 0 && "How much would you like to pledge?"}
          {step === 1 && "Your details"}
          {step === 2 && "Check this is right"}
        </h2>

        {errors.form && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {errors.form}
          </p>
        )}

        {step === 0 && (
          <div className="mt-5">
            <Label htmlFor="amount" className="text-sm text-neutral-600">
              Amount in Kenyan shillings
            </Label>

            <div className="mt-2 flex items-baseline gap-2 border-b-2 border-neutral-200 pb-2 focus-within:border-campfire">
              <span className="text-2xl font-medium text-neutral-400">KES</span>
              <input
                id="amount"
                // type="text" with inputMode numeric gives the Android and iOS
                // numeric keypad while still allowing grouped digits. type
                // "number" would forbid the separators and add spinners.
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                placeholder="0"
                aria-describedby={errors.amountKes ? "amount-error" : undefined}
                aria-invalid={Boolean(errors.amountKes)}
                value={groupDigits(amountDigits)}
                onChange={(event) =>
                  setAmountDigits(
                    event.target.value.replace(/\D/g, "").slice(0, 9),
                  )
                }
                className="tabular w-full min-w-0 bg-transparent text-4xl font-semibold tracking-tight text-navy outline-none placeholder:text-neutral-300"
              />
            </div>

            {errors.amountKes && <FieldError id="amount-error">{errors.amountKes}</FieldError>}

            <div className="mt-4 flex flex-wrap gap-2">
              {QUICK_AMOUNTS.map((amount) => {
                const selected = amountDigits === String(amount);
                return (
                  <button
                    key={amount}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setAmountDigits(String(amount))}
                    className={cn(
                      "tabular rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
                      "focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none",
                      selected
                        ? "border-navy bg-navy text-white"
                        : "border-neutral-200 bg-white text-navy hover:border-denim",
                    )}
                  >
                    {amount.toLocaleString("en-KE")}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="mt-5 space-y-5">
            <Field
              id="fullName"
              label="Full name"
              error={errors.fullName}
              required
            >
              <Input
                id="fullName"
                name="name"
                autoComplete="name"
                value={fullName}
                aria-invalid={Boolean(errors.fullName)}
                onChange={(event) => setFullName(event.target.value)}
              />
            </Field>

            <Field
              id="phone"
              label="Phone number"
              error={errors.phone}
              hint="We use this to reach you about your pledge. It is never shown publicly."
              required
            >
              <div className="flex">
                <span
                  aria-hidden
                  className="tabular flex items-center rounded-l-lg border border-r-0 border-neutral-200 bg-neutral-50 px-3 text-sm text-neutral-600"
                >
                  +254
                </span>
                <Input
                  id="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="712 345 678"
                  className="tabular rounded-l-none"
                  value={phone}
                  aria-invalid={Boolean(errors.phone)}
                  onChange={(event) => setPhone(event.target.value)}
                  onBlur={() => {
                    // Settle whatever they typed into the local nine digits, so
                    // the visible prefix and the value agree.
                    const normalized = normalizeKenyanPhone(phone);
                    if (normalized) setPhone(normalized.slice(4));
                  }}
                />
              </div>
            </Field>

            <Field
              id="email"
              label="Email address"
              error={errors.email}
              hint="Optional."
            >
              <Input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                aria-invalid={Boolean(errors.email)}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>

            <Field
              id="membershipNo"
              label="Church membership number"
              error={errors.membershipNo}
              hint="Optional. Leave blank if you are not a member."
            >
              <Input
                id="membershipNo"
                autoComplete="off"
                value={membershipNo}
                aria-invalid={Boolean(errors.membershipNo)}
                onChange={(event) => setMembershipNo(event.target.value)}
              />
            </Field>

            <fieldset className="space-y-3 border-t border-neutral-100 pt-5">
              <legend className="sr-only">Your permissions</legend>

              <p className="text-xs leading-relaxed text-neutral-500">
                How we handle your details is set out in our{" "}
                <Link
                  href="/privacy"
                  className="text-denim underline underline-offset-4"
                >
                  privacy notice
                </Link>
                .
              </p>

              <Consent
                id="recordConsent"
                checked={recordConsent}
                onChange={setRecordConsent}
                error={errors.recordConsent}
              >
                Record my pledge for the Crystal Fountain Development Project.
              </Consent>

              <Consent
                id="contactConsent"
                checked={contactConsent}
                onChange={setContactConsent}
              >
                You may contact me about this pledge and how to pay it.
              </Consent>

              <Consent
                id="displayConsent"
                checked={displayConsent}
                onChange={setDisplayConsent}
              >
                You may show my name publicly on the list of pledgers.
              </Consent>
            </fieldset>
          </div>
        )}

        {step === 2 && (
          <div className="mt-5">
            <dl className="divide-y divide-neutral-100 text-sm">
              <Row label="Amount">
                <span className="tabular text-lg font-semibold text-navy">
                  {Number.isFinite(amountKes)
                    ? formatKes(BigInt(amountDigits || "0") * 100n)
                    : "-"}
                </span>
              </Row>
              <Row label="Name">{fullName}</Row>
              <Row label="Phone">
                <span className="tabular">
                  {normalizedPhone
                    ? formatPhoneForDisplay(normalizedPhone)
                    : phone}
                </span>
              </Row>
              {email && <Row label="Email">{email}</Row>}
              {membershipNo && <Row label="Membership">{membershipNo}</Row>}
              <Row label="Contact me">{contactConsent ? "Yes" : "No"}</Row>
              <Row label="Show my name">{displayConsent ? "Yes" : "No"}</Row>
            </dl>

            <p className="mt-5 rounded-lg bg-navy/5 px-4 py-3 text-sm leading-relaxed text-navy">
              A pledge is a promise to give, not a payment. Nothing is charged
              now. You will get a reference number to use when you pay, and the
              treasurer&rsquo;s receipt is the only receipt.
            </p>
          </div>
        )}

        <div className="mt-7 flex items-center gap-3">
          {step > 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={() => goTo(step - 1)}
              disabled={submitting}
            >
              Back
            </Button>
          )}

          <Button
            type="button"
            onClick={step === 2 ? submit : next}
            disabled={submitting}
            className="ml-auto min-w-36 bg-campfire text-white hover:bg-campfire/90"
          >
            {step === 2
              ? submitting
                ? "Recording..."
                : "Make a pledge"
              : "Continue"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function StepIndicator({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Progress through the form">
      {STEP_LABELS.map((label, index) => (
        <li key={label} className="flex flex-1 flex-col gap-1.5">
          <span
            className={cn(
              "h-1 rounded-full transition-colors",
              index <= step ? "bg-campfire" : "bg-neutral-200",
            )}
          />
          <span
            className={cn(
              "text-xs",
              index === step ? "font-medium text-navy" : "text-neutral-500",
            )}
            aria-current={index === step ? "step" : undefined}
          >
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  required,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-sm text-neutral-700">
        {label}
        {!required && <span className="ml-1 text-neutral-400">(optional)</span>}
      </Label>
      <div className="mt-1.5">{children}</div>
      {hint && !error && (
        <p className="mt-1.5 text-xs text-neutral-500">{hint}</p>
      )}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="mt-1.5 text-sm text-red-700">
      {children}
    </p>
  );
}

function Consent({
  id,
  checked,
  onChange,
  error,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-invalid={Boolean(error)}
          className="mt-0.5 size-5 shrink-0 accent-campfire"
        />
        <Label htmlFor={id} className="text-sm leading-relaxed text-neutral-700">
          {children}
        </Label>
      </div>
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="text-right font-medium text-navy">{children}</dd>
    </div>
  );
}
