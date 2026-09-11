import Link from "next/link";

import { CampaignProgress } from "@/components/campaign/campaign-progress";
import { PaymentInstructions } from "@/components/campaign/payment-instructions";
import { CopyButton } from "@/components/pledge/copy-button";
import { SuccessMark } from "@/components/pledge/success-mark";
import { ShareButton } from "@/components/pledge/share-button";
import type { CampaignTotalsDto } from "@/lib/campaign";
import { formatDate, formatKES } from "@/lib/format";
import type { ResolvedPaymentDetails } from "@/lib/payment-details";
import { redemptionSummary } from "@/lib/redemption";
import { REDEMPTION_PLANS } from "@/server/contracts/pledges";
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
  isAddition = false,
  details,
}: {
  pledge: PublicPledgeView;
  totals: CampaignTotalsDto;
  token: string;
  siteUrl: string;
  justCreated?: boolean;
  /**
   * Whether the submission that led here added to a pledge that already
   * existed. Only ever true alongside justCreated: arriving at this page from a
   * QR code months later is not an addition, it is a visit.
   */
  isAddition?: boolean;
  /** Where money is sent, read from the campaign row by the page above. */
  details: ResolvedPaymentDetails;
}) {
  const pledgeUrl = `${siteUrl.replace(/\/$/, "")}/p/${token}`;

  /*
   * The redemption plan, rebuilt from the columns rather than from a stored
   * sentence, so a pledge that later accumulates shows the plan for what it now
   * owes rather than for what it owed when the sentence was written.
   */
  const plan = pledge.installmentFrequency;
  const planSummary = plan ? redemptionSummary(pledge.amountMinor, plan) : null;

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

          {/*
            Straight after submitting, the heading belongs beside the checkmark
            below rather than up here, so the celebration is one block instead of
            two halves with a colour change between them. Arriving from a QR code
            months later is not a celebration, and that view keeps its plain
            heading.
          */}
          {justCreated ? (
            <p className="mt-4 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Crystal Fountain
            </p>
          ) : (
            <>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Pledge acknowledgement
              </h1>

              {pledge.displayName && (
                <p className="mt-1 text-white/70">
                  Thank you, {pledge.displayName}.
                </p>
              )}
            </>
          )}
        </div>
      </header>

      <main className="px-4 py-8 pb-16 sm:px-6">
        <div className="mx-auto w-full max-w-2xl space-y-5">
          {justCreated && (
            <section className="rounded-2xl border border-black/5 bg-white p-5 text-center shadow-sm sm:p-7">
              <SuccessMark />

              {/*
                CLAUDE.md fixes this wording: the success state says the pledge
                is recorded. "Received" is the word the tracker uses for money
                actually in the bank, and a page whose whole job is to stop
                somebody believing they have just paid cannot be the one place
                that blurs the two.
              */}
              <h1 className="mt-4 text-2xl font-semibold tracking-tight text-navy sm:text-3xl">
                {isAddition
                  ? "Thank you. Your pledge is updated."
                  : "Thank you. Your pledge is recorded."}
              </h1>

              {isAddition ? (
                <p className="mt-2 text-base text-neutral-700">
                  Your pledge now stands at{" "}
                  <span className="tabular font-semibold text-navy">
                    {formatKES(pledge.amountMinor)}
                  </span>{" "}
                  in total, on the same reference you already had.
                </p>
              ) : (
                pledge.displayName && (
                  <p className="mt-2 text-base text-neutral-700">
                    Thank you, {pledge.displayName}.
                  </p>
                )
              )}
            </section>
          )}

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
                label="Share your pledge"
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
              {plan && (
                <div className="flex items-baseline justify-between gap-4 py-3">
                  <dt className="text-neutral-500">Redemption plan</dt>
                  <dd className="text-right font-medium text-navy">
                    {REDEMPTION_PLANS[plan].label}
                    {planSummary && (
                      <span className="tabular block text-xs font-normal text-neutral-500">
                        {planSummary}
                      </span>
                    )}
                  </dd>
                </div>
              )}
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
            <PaymentInstructions details={details} reference={pledge.reference} />
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

          {/*
            The way back to the form, carrying this pledge's own token.
            Accumulation makes a second pledge an addition rather than a
            duplicate, so there is no longer any reason to discourage somebody
            from coming back, and the token is what lets the form greet them
            with what they already have. It is the same unguessable token that
            opens this page, so the link gives away nothing that whoever is
            holding it cannot already see.
          */}
          <section className="rounded-2xl border border-denim/25 bg-denim/5 p-5 text-center sm:p-6">
            <h2 className="font-semibold text-navy">Want to add more?</h2>
            <p className="mt-1 text-sm leading-relaxed text-neutral-700">
              A second pledge from the same phone number is added to this one.
              You keep this reference and this QR code.
            </p>
            <Link
              href={`/pledge?add=${token}`}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-denim px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-denim/90 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
            >
              Increase my pledge
              <span aria-hidden>&rarr;</span>
            </Link>
          </section>

          <p className="text-center text-sm text-neutral-600">
            Keep this link. It is the only way back to this page.
          </p>
        </div>
      </main>
    </div>
  );
}
