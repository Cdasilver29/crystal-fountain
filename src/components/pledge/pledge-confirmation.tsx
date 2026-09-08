import Link from "next/link";

import { CampaignProgress } from "@/components/campaign/campaign-progress";
import { PaymentInstructions } from "@/components/campaign/payment-instructions";
import { CopyButton } from "@/components/pledge/copy-button";
import { ShareButton } from "@/components/pledge/share-button";
import type { CampaignTotalsDto } from "@/lib/campaign";
import { formatDate, formatKES } from "@/lib/format";
import type { PublicPledgeView } from "@/server/services/pledges";

/**
 * The pledge acknowledgement.
 *
 * Rendered both at /pledge/confirmed/<token> straight after submitting and at
 * /p/<token>, which is where the QR code points. It shows only what the service
 * returns, which is display safe: no phone number and no email address.
 *
 * The commonest failure of pledge platforms is that a member submits the form
 * and believes they have given, so this page says plainly that a pledge is a
 * promise and that the treasurer's receipt is the only receipt.
 */
export function PledgeConfirmation({
  pledge,
  totals,
  token,
  siteUrl,
  justCreated = false,
}: {
  pledge: PublicPledgeView;
  totals: CampaignTotalsDto;
  token: string;
  siteUrl: string;
  justCreated?: boolean;
}) {
  const pledgeUrl = `${siteUrl.replace(/\/$/, "")}/p/${token}`;

  return (
    <div className="flex flex-1 flex-col bg-neutral-50">
      <header className="bg-navy px-4 py-8 sm:px-6">
        <div className="mx-auto w-full max-w-2xl">
          <Link
            href="/"
            className="rounded text-sm text-white/70 underline-offset-4 hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
          >
            Crystal Fountain Development Project
          </Link>

          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {justCreated ? "Your pledge is recorded" : "Pledge acknowledgement"}
          </h1>

          {pledge.displayName && (
            <p className="mt-1 text-white/70">Thank you, {pledge.displayName}.</p>
          )}
        </div>
      </header>

      <main className="px-4 py-8 pb-16 sm:px-6">
        <div className="mx-auto w-full max-w-2xl space-y-5">
          <section className="rounded-2xl border border-black/5 bg-white p-5 text-center shadow-sm sm:p-7">
            <h2 className="text-sm font-medium tracking-wide text-neutral-500">
              Your reference number
            </h2>

            <p className="tabular mt-2 text-4xl font-semibold tracking-tight text-navy sm:text-5xl">
              {pledge.reference}
            </p>

            <p className="mt-2 text-sm text-neutral-600">
              Quote this whenever you pay or ask about your pledge.
            </p>

            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <CopyButton value={pledge.reference} />
              <ShareButton
                url={pledgeUrl}
                title={`My pledge to the Crystal Fountain Development Project, ${pledge.reference}`}
              />
            </div>

            <div className="mt-7 border-t border-neutral-100 pt-6">
              {/* The QR encodes this page's URL and nothing else. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/pledges/${token}/qr.svg`}
                alt={`QR code linking to this pledge acknowledgement, reference ${pledge.reference}`}
                width={200}
                height={200}
                className="mx-auto size-44 sm:size-52"
              />
              <p className="mt-3 text-xs text-neutral-500">
                Scan to open this page again on any phone.
              </p>
            </div>
          </section>

          <section className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:p-7">
            <dl className="divide-y divide-neutral-100 text-sm">
              <div className="flex items-baseline justify-between gap-4 pb-3">
                <dt className="text-neutral-500">Amount pledged</dt>
                <dd className="tabular text-lg font-semibold text-navy">
                  {formatKES(pledge.amountMinor)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-3">
                <dt className="text-neutral-500">Recorded on</dt>
                <dd className="font-medium text-navy">
                  {formatDate(pledge.createdAt)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 pt-3">
                <dt className="text-neutral-500">Status</dt>
                <dd className="font-medium text-navy">
                  {pledge.status === "pending"
                    ? "Awaiting confirmation"
                    : pledge.status === "verified"
                      ? "Confirmed"
                      : pledge.status === "fulfilled"
                        ? "Fully paid"
                        : "Closed"}
                </dd>
              </div>
            </dl>
          </section>

          <section>
            <h2 className="mb-4 text-lg font-semibold tracking-tight text-navy">
              How to pay your pledge
            </h2>
            <PaymentInstructions reference={pledge.reference} />
          </section>

          <section className="rounded-2xl border border-campfire/20 bg-campfire/5 p-5 sm:p-7">
            <h2 className="font-semibold text-navy">
              This is a pledge, not a payment
            </h2>
            {/*
              The brief for this section asked for "You will receive payment
              instructions separately" as the middle sentence. That would be
              untrue: the instructions are on this page, immediately above, and
              v1 sends no SMS or email, so nothing arrives separately. The
              sentence points at them instead and carries the reference, which
              is what the treasurer matches a payment on.
            */}
            <p className="mt-2 text-sm leading-relaxed text-neutral-700">
              Nothing has been charged and no money has changed hands. Payment
              instructions are shown above; quote reference{" "}
              <span className="tabular font-semibold text-navy">
                {pledge.reference}
              </span>{" "}
              when you pay. The church treasurer&rsquo;s official receipt is the
              only valid receipt for your contribution.
            </p>
          </section>

          <section className="rounded-2xl bg-navy p-5 sm:p-7">
            <h2 className="text-sm font-medium tracking-wide text-white/70">
              Where the project stands
            </h2>
            <div className="mt-3">
              <CampaignProgress totals={totals} />
            </div>
          </section>

          <p className="text-center text-sm text-neutral-600">
            Keep this link. It is the only way back to this page.
          </p>
        </div>
      </main>
    </div>
  );
}
