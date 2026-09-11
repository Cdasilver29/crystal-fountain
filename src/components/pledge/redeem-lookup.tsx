"use client";

import { useState } from "react";
import Link from "next/link";

import { PaymentInstructions } from "@/components/campaign/payment-instructions";
import { CopyButton } from "@/components/pledge/copy-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CONTACT } from "@/content/campaign";
import { formatDate, formatKES } from "@/lib/format";
import type { ResolvedPaymentDetails } from "@/lib/payment-details";
import { redemptionSummary } from "@/lib/redemption";
import { lookupPledgeInput, REDEMPTION_PLANS } from "@/server/contracts/pledges";

/**
 * Looking up a pledge in order to pay it.
 *
 * Both a reference and a phone number, and they have to be the same pledge's.
 * The reference on its own is a sequential counter anybody could walk, and in a
 * congregation everybody has everybody's phone number, so either alone would
 * make this page a way of reading other people's giving records. The server
 * enforces the pair; this form only makes it obvious.
 *
 * A miss says one thing regardless of which half was wrong. Telling somebody
 * that a reference exists but the number does not match it would hand back the
 * fact the pair is there to protect.
 */

type Found = {
  reference: string;
  publicToken: string;
  firstName: string;
  amountMinor: string;
  paidMinor: string;
  outstandingMinor: string;
  status: string;
  installmentFrequency: keyof typeof REDEMPTION_PLANS | null;
  createdAt: string;
};

type State =
  | { kind: "idle" }
  | { kind: "found"; pledge: Found }
  | { kind: "missing" };

const STATUS_LABELS: Record<string, string> = {
  pending: "Awaiting confirmation",
  verified: "Confirmed",
  fulfilled: "Fully paid",
  cancelled: "Closed",
  void: "Closed",
};

export function RedeemLookup({
  details,
}: {
  /** Where money is sent, read from the campaign row by the page above. */
  details: ResolvedPaymentDetails;
}) {
  const [reference, setReference] = useState("");
  const [phone, setPhone] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle" });

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    const parsed = lookupPledgeInput.safeParse({ reference, phone });

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
    setSubmitting(true);

    try {
      const response = await fetch("/api/redeem/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setErrors({
          form:
            body?.title ??
            "We could not look that up just now. Please try again in a moment.",
        });
        setState({ kind: "idle" });
        return;
      }

      setState(body.pledge ? { kind: "found", pledge: body.pledge } : { kind: "missing" });
    } catch {
      setErrors({
        form: "We could not reach the server. Check your connection and try again.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  const found = state.kind === "found" ? state.pledge : null;
  const plan = found?.installmentFrequency ?? null;

  return (
    <div className="space-y-10">
      <section aria-labelledby="lookup-heading">
        <h2
          id="lookup-heading"
          className="text-2xl font-semibold tracking-tight text-navy sm:text-3xl"
        >
          Look up your pledge
        </h2>

        <p className="mt-2 max-w-2xl text-base leading-relaxed text-neutral-700">
          Enter both your reference and the phone number you pledged with. We ask
          for both so that nobody else can read your pledge from one of them.
        </p>

        <form
          onSubmit={submit}
          className="mt-6 rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:p-6"
        >
          {errors.form && (
            <p
              role="alert"
              className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {errors.form}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="reference">Pledge reference</Label>
              <Input
                id="reference"
                value={reference}
                placeholder="CF26-000124"
                autoComplete="off"
                aria-invalid={Boolean(errors.reference)}
                aria-describedby={errors.reference ? "reference-error" : undefined}
                onChange={(event) => setReference(event.target.value)}
                className="tabular mt-2"
              />
              {errors.reference && (
                <p id="reference-error" className="mt-1.5 text-sm text-red-700">
                  {errors.reference}
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="lookup-phone">Phone number</Label>
              <Input
                id="lookup-phone"
                value={phone}
                placeholder="0712 345 678"
                inputMode="tel"
                autoComplete="tel"
                aria-invalid={Boolean(errors.phone)}
                aria-describedby={errors.phone ? "lookup-phone-error" : undefined}
                onChange={(event) => setPhone(event.target.value)}
                className="tabular mt-2"
              />
              {errors.phone && (
                <p id="lookup-phone-error" className="mt-1.5 text-sm text-red-700">
                  {errors.phone}
                </p>
              )}
            </div>
          </div>

          <Button type="submit" disabled={submitting} className="mt-5">
            {submitting ? "Looking…" : "Find my pledge"}
          </Button>

          <p className="mt-3 text-sm text-neutral-600">
            Lost your reference? It is on the acknowledgement page your QR code
            opens. If you cannot find it, call {CONTACT.leaderName} on{" "}
            <a
              href={CONTACT.phoneHref}
              className="rounded text-denim underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
            >
              {CONTACT.phoneDisplay}
            </a>
            .
          </p>
        </form>

        {state.kind === "missing" && (
          <p
            role="status"
            className="mt-4 rounded-xl border border-neutral-200 bg-white p-4 text-sm leading-relaxed text-neutral-700"
          >
            We could not find a pledge with that reference and that phone number
            together. Check both, or call the treasurer above. For your
            protection we do not say which of the two did not match.
          </p>
        )}

        {found && (
          <div
            role="status"
            className="mt-5 rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:p-6"
          >
            <p className="text-sm text-neutral-500">
              Found your pledge, {found.firstName}.
            </p>

            <p className="tabular mt-1 text-2xl font-semibold tracking-tight text-navy">
              {found.reference}
            </p>

            <dl className="mt-5 divide-y divide-neutral-100 text-sm">
              <Row label="Pledged">{formatKES(found.amountMinor)}</Row>
              <Row label="Paid so far">{formatKES(found.paidMinor)}</Row>
              <Row label="Still outstanding" strong>
                {formatKES(found.outstandingMinor)}
              </Row>
              <Row label="Status">
                {STATUS_LABELS[found.status] ?? found.status}
              </Row>
              {plan && (
                <Row label="Redemption plan">
                  <span className="text-right">
                    {REDEMPTION_PLANS[plan].label}
                    <span className="tabular block text-xs font-normal text-neutral-500">
                      {redemptionSummary(BigInt(found.amountMinor), plan)}
                    </span>
                  </span>
                </Row>
              )}
              <Row label="Pledged on">{formatDate(found.createdAt)}</Row>
            </dl>

            <div className="mt-5 flex flex-wrap gap-3">
              <CopyButton value={found.reference} />
              <Link
                href={`/p/${found.publicToken}`}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-neutral-200 px-4 text-sm font-medium text-navy transition-colors hover:border-denim focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
              >
                Open my pledge page
              </Link>
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="pay-heading">
        <h2
          id="pay-heading"
          className="text-2xl font-semibold tracking-tight text-navy sm:text-3xl"
        >
          How to pay
        </h2>

        <p className="mt-2 max-w-2xl text-base leading-relaxed text-neutral-700">
          When paying via M-Pesa, use your pledge reference as the account
          number. That is what lets the treasury match your payment to your
          pledge.
        </p>

        {/*
          The reference fills itself in once a lookup has found one, so the
          steps below say exactly what to type rather than describing what to
          type. Before that they carry the fund name, which is what somebody
          giving without a pledge needs.
        */}
        <div className="mt-6">
          <PaymentInstructions details={details} reference={found?.reference} />
        </div>
      </section>
    </div>
  );
}

function Row({
  label,
  children,
  strong = false,
}: {
  label: string;
  children: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="text-neutral-500">{label}</dt>
      <dd
        className={
          strong
            ? "tabular text-lg font-semibold text-campfire"
            : "tabular font-medium text-navy"
        }
      >
        {children}
      </dd>
    </div>
  );
}
