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
  const origin = siteUrl.replace(/\/$/, "");
  const pledgeUrl = `${origin}/p/${token}`;

  /*
   * The redeem page, as something to read aloud or type.
   *
   * Built off NEXT_PUBLIC_SITE_URL rather than typed into the copy, so a
   * preview deployment does not print the production host at somebody and a
   * change of subdomain does not leave a dead address in the one paragraph a
   * member is most likely to act on. The scheme is dropped: this is the printed
   * form, and nobody says "https" out loud. The link itself is a plain relative
   * href, so it stays on whichever host the reader is already on.
   */
  const redeemLabel = `${origin}/redeem`.replace(/^https?:\/\//, "");

  /*
   * What goes in the message under the card.
   *
   * The amount and the reference are the pledger's own and they are choosing to
   * send them. The name is not here and neither is anything else: this text is
   * pasted into a group, and the card above it carries the same two facts and
   * no more. The invitation at the end is the point of sharing at all.
   */
  const shareText = `I have pledged ${formatKES(pledge.amountMinor)} toward the Crystal Fountain Development Project. Reference: ${pledge.reference}. Make yours at ${origin}/pledge`;

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
                title="This is My Pledge"
                text={shareText}
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
                Scan this QR code with any phone camera to view your pledge
                details anytime.
              </p>
            </div>
          </section>

          {/*
            What the reference is for, and how not to lose it.

            Set on amber rather than on the white every other card uses, because
            this is the one block on the page that asks the reader to do
            something before they leave it. Most arrivals here are on a phone in
            a church car park, and a reference that is only ever on a screen
            somebody navigates away from is a reference the treasury will spend
            an evening matching by hand.
          */}
          <section className="rounded-2xl border border-amber-300/70 bg-amber-50 p-5 shadow-sm sm:p-7">
            <h2 className="text-lg font-semibold tracking-tight text-navy">
              Save your pledge reference
            </h2>

            <p className="mt-3 text-sm leading-relaxed text-neutral-800">
              Your reference number{" "}
              <span className="tabular font-semibold text-navy">
                {pledge.reference}
              </span>{" "}
              is your pledge identity. You will need it to:
            </p>

            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-neutral-800">
              <Bullet>Make payments via M-Pesa or bank transfer</Bullet>
              <Bullet>Check your pledge balance</Bullet>
              <Bullet>Contact the church about your pledge</Bullet>
            </ul>

            <h3 className="mt-6 font-semibold text-navy">How to save it</h3>

            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-neutral-800">
              <Bullet>Screenshot this page now</Bullet>
              <Bullet>
                Tap &ldquo;Copy reference&rdquo; above to save it to your
                clipboard
              </Bullet>
              <Bullet>
                Tap &ldquo;Share your pledge&rdquo; above to send it to yourself
                by WhatsApp or email
              </Bullet>
              {/*
                The brief for this block said the QR code was below. On this page
                it is above, inside the card carrying the reference itself, and
                an instruction that points somebody the wrong way down a page is
                worse than no instruction.
              */}
              <Bullet>
                Your QR code above contains your reference. You can scan it
                anytime to look up your pledge.
              </Bullet>
            </ul>
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

          {/*
            The same information as the tabs above, reduced to the four things
            that actually have to happen and put in the order they happen in.

            The tabs are a reference somebody comes back to; this is the list
            they read once, on the day, before closing the page. The paybill is
            read from the resolved payment details rather than typed here, so it
            cannot disagree with the panel directly above it when the treasurer
            changes it on the settings screen.
          */}
          <section className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:p-7">
            <h2 className="text-lg font-semibold tracking-tight text-navy">
              What to do next
            </h2>

            <ol className="mt-4 space-y-3 text-sm text-neutral-800">
              <Step index={1}>Save your reference number (above)</Step>
              <Step index={2}>
                Set up your payment plan using M-Pesa paybill{" "}
                <span className="tabular font-semibold text-navy">
                  {details.paybill}
                </span>
              </Step>
              <Step index={3}>
                Quote your reference{" "}
                <span className="tabular font-semibold text-navy">
                  {pledge.reference}
                </span>{" "}
                as the account number when paying
              </Step>
              <Step index={4}>
                Check your progress anytime at{" "}
                <Link
                  href="/redeem"
                  className="rounded font-medium break-words text-denim underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
                >
                  {redeemLabel}
                </Link>
              </Step>
            </ol>
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

/**
 * One line in the amber block.
 *
 * The marker is a drawn dot rather than a list-style bullet, so it keeps its
 * size and its colour and sits on the first line's baseline however many lines
 * the text runs to at 360px.
 */
function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span
        aria-hidden
        className="mt-[0.45rem] size-1.5 shrink-0 rounded-full bg-campfire"
      />
      <span>{children}</span>
    </li>
  );
}

/**
 * One step in "What to do next".
 *
 * Numbered the same way the M-Pesa steps above it are, because they are the
 * same kind of instruction and a reader who has just scrolled past one should
 * recognise the other. The number is drawn rather than left to the list
 * marker, which cannot be styled into a filled circle.
 */
function Step({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className="tabular mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-navy/10 text-xs font-semibold text-navy"
      >
        {index}
      </span>
      <span className="leading-relaxed">{children}</span>
    </li>
  );
}
