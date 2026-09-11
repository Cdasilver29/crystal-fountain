"use client";

import Link from "next/link";
import { useId, useState } from "react";

import { CopyButton } from "@/components/pledge/copy-button";
import { CONTACT } from "@/content/campaign";
import type { ResolvedPaymentDetails } from "@/lib/payment-details";
import { cn } from "@/lib/utils";

/**
 * How to pay, as two tabs.
 *
 * Shared by the confirmation page, the public pledge page and the home page,
 * so a member who wants to give without pledging reads exactly the same
 * numbers as one who pledged. The figures come from src/content/campaign.ts
 * and are never retyped.
 *
 * M-Pesa opens first because that is how most of the congregation will give.
 * Account numbers are set in tabular numerals and are selectable, because
 * people will copy them by hand.
 *
 * Both panels are always in the document and the inactive one carries the
 * hidden attribute. The noscript rule below reveals both, so a visitor without
 * JavaScript still gets the bank details rather than a tab they cannot open.
 */

type TabId = "mpesa" | "bank";

const TABS: readonly { id: TabId; label: string }[] = [
  { id: "mpesa", label: "M-Pesa" },
  { id: "bank", label: "Bank transfer" },
];

export function PaymentInstructions({
  details,
  reference,
  showContact = true,
  className,
}: {
  /**
   * Where the money goes, resolved on the server from the campaign row with
   * the values in src/content/campaign.ts as the fallback.
   */
  details: ResolvedPaymentDetails;
  /** The pledger's CF26 reference, shown as the bank transfer reference. */
  reference?: string;
  /**
   * Whether to print the enquiries line. The home page turns it off, because
   * the accountability section right below it already carries the same name
   * and the same number. The confirmation page and the public pledge page
   * leave it on: there it is the only way to reach anyone.
   */
  showContact?: boolean;
  className?: string;
}) {
  const [active, setActive] = useState<TabId>("mpesa");

  /*
   * What to type into M-Pesa, with the pledger's own reference in the account
   * field when there is one. The account number is what the treasury matches a
   * payment against, and a reference identifies one pledge where the fund name
   * identifies only the fund. Somebody giving without having pledged has no
   * reference, so the fund name stays as the fallback.
   */
  const steps = [
    "Go to M-Pesa > Lipa na M-Pesa > Pay Bill",
    `Business Number: ${details.paybill}`,
    `Account Number: ${reference ?? details.accountName}`,
    "Enter Amount",
    "Enter PIN and confirm",
  ];
  const baseId = useId();

  const tabId = (id: TabId) => `${baseId}-tab-${id}`;
  const panelId = (id: TabId) => `${baseId}-panel-${id}`;

  return (
    <div className={cn("space-y-5", className)}>
      <noscript>
        <style
          dangerouslySetInnerHTML={{
            __html: "[data-payment-panel]{display:block!important}",
          }}
        />
      </noscript>

      <div
        role="tablist"
        aria-label="Ways to give"
        className="flex gap-6 border-b border-neutral-200"
      >
        {TABS.map((tab) => {
          const selected = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={tabId(tab.id)}
              aria-selected={selected}
              aria-controls={panelId(tab.id)}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.id)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
                  return;
                }
                event.preventDefault();
                const next = active === "mpesa" ? "bank" : "mpesa";
                setActive(next);
                document.getElementById(tabId(next))?.focus();
              }}
              className={cn(
                "-mb-px cursor-pointer border-b-2 px-1 pb-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none sm:text-base",
                selected
                  ? "border-campfire text-navy"
                  : "border-transparent text-neutral-500 hover:text-neutral-700",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={panelId("mpesa")}
        aria-labelledby={tabId("mpesa")}
        data-payment-panel
        hidden={active !== "mpesa"}
        className="tab-fade"
      >
        <section className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
          <h3 className="font-semibold text-navy">Pay by M-Pesa</h3>

          <ol className="mt-4 space-y-2.5 text-sm text-neutral-700">
            {steps.map((step, index) => (
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
            <Detail label="Business number" value={details.paybill} copyable />
            <Detail
              label="Account number"
              value={reference ?? details.accountName}
              copyable
            />
          </dl>
        </section>
      </div>

      <div
        role="tabpanel"
        id={panelId("bank")}
        aria-labelledby={tabId("bank")}
        data-payment-panel
        hidden={active !== "bank"}
        className="tab-fade"
      >
        <section className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
          <h3 className="font-semibold text-navy">Pay by bank transfer</h3>

          <dl className="mt-4 space-y-2 text-sm">
            <Detail label="Account name" value={details.bankAccountName} />
            <Detail label="Bank" value={details.bankName} />
            <Detail label="Branch" value={details.bankBranch} />
            <Detail label="Account number" value={details.bankAccount} copyable />
            <Detail label="Swift code" value={details.bankSwift} copyable />
            <Detail label="Branch code" value={details.bankBranchCode} />
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

      {showContact && (
        <p className="text-sm text-neutral-700">
          For enquiries contact {CONTACT.leaderName},{" "}
          <Link
            href={CONTACT.phoneHref}
            className="rounded font-medium text-denim underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
          >
            {CONTACT.phoneDisplay}
          </Link>
        </p>
      )}

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
