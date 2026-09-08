import Link from "next/link";

import { CopyButton } from "@/components/pledge/copy-button";
import { BANK, CONTACT, MPESA, MPESA_STEPS } from "@/content/campaign";
import { cn } from "@/lib/utils";

/**
 * How to pay.
 *
 * Shared by the confirmation page and the home page, so a member who wants to
 * give without pledging reads exactly the same numbers as one who pledged. The
 * figures come from src/content/campaign.ts and are never retyped.
 *
 * Two columns on desktop, stacked on mobile. Account numbers are set in tabular
 * numerals and are selectable, because people will copy them by hand.
 */
export function PaymentInstructions({
  reference,
  className,
}: {
  /** The pledger's CF26 reference, shown as the bank transfer reference. */
  reference?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-5", className)}>
      <div className="grid gap-5 md:grid-cols-2">
        <section className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
          <h3 className="font-semibold text-navy">Pay by M-Pesa</h3>

          <ol className="mt-4 space-y-2.5 text-sm text-neutral-700">
            {MPESA_STEPS.map((step, index) => (
              <li key={step} className="flex gap-3">
                <span
                  aria-hidden
                  className="tabular mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-navy/10 text-xs font-semibold text-navy"
                >
                  {index + 1}
                </span>
                <span className="leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>

          <dl className="mt-5 space-y-2 border-t border-neutral-100 pt-4 text-sm">
            <Detail label="Business number" value={MPESA.paybill} copyable />
            <Detail label="Account number" value={MPESA.account} copyable />
          </dl>
        </section>

        <section className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
          <h3 className="font-semibold text-navy">Pay by bank transfer</h3>

          <dl className="mt-4 space-y-2 text-sm">
            <Detail label="Account name" value={BANK.accountName} />
            <Detail label="Bank" value={BANK.bank} />
            <Detail label="Branch" value={BANK.branch} />
            <Detail label="Account number" value={BANK.accountNumber} copyable />
            <Detail label="Swift code" value={BANK.swift} copyable />
            <Detail label="Branch code" value={BANK.branchCode} />
            {reference && <Detail label="Reference" value={reference} copyable />}
          </dl>

          {!reference && (
            <p className="mt-4 border-t border-neutral-100 pt-4 text-sm leading-relaxed text-neutral-600">
              If you have recorded a pledge, use your CF26 reference number as
              the transfer reference so the treasury can match your payment.
            </p>
          )}
        </section>
      </div>

      <p className="text-sm text-neutral-700">
        For enquiries contact {CONTACT.leaderName},{" "}
        <Link
          href={CONTACT.phoneHref}
          className="font-medium text-denim underline underline-offset-4"
        >
          {CONTACT.phoneDisplay}
        </Link>
      </p>

      <p className="rounded-2xl bg-navy/5 px-4 py-3 text-sm leading-relaxed text-navy">
        After making your payment, the church treasury will reconcile your
        contribution with your pledge. You do not need to take any further
        action.
      </p>
    </div>
  );
}

function Detail({
  label,
  value,
  copyable = false,
}: {
  label: string;
  value: string;
  copyable?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-neutral-500">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2 text-right">
        <span className="tabular font-medium break-words text-navy select-all">
          {value}
        </span>
        {copyable && <CopyButton value={value} label="Copy" compact />}
      </dd>
    </div>
  );
}
