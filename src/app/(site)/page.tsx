import type { Metadata } from "next";
import Link from "next/link";

import { PaymentInstructions } from "@/components/campaign/payment-instructions";
import { FinalCta } from "@/components/home/final-cta";
import { Hero } from "@/components/home/hero";
import { JourneyTimeline } from "@/components/home/journey-timeline";
import { KeyNumbers } from "@/components/home/key-numbers";
import { VisionSection } from "@/components/home/vision-section";
import { CAMPAIGN, CONTACT } from "@/content/campaign";
import { getCampaignTotals } from "@/lib/campaign";
import { pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata({
  title: CAMPAIGN.name,
  path: "/",
});

export default async function HomePage() {
  // Read on the server so the first paint carries real numbers and the page is
  // correct with JavaScript disabled. LiveTracker takes over after hydration.
  const totals = await getCampaignTotals();

  return (
    <>
      <Hero totals={totals} />
      <VisionSection />
      <KeyNumbers />
      <JourneyTimeline />

      <section className="bg-white px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto w-full max-w-5xl">
          <h2 className="text-2xl font-semibold tracking-tight text-navy sm:text-3xl">
            How to give
          </h2>
          <p className="mt-3 max-w-3xl text-base leading-relaxed text-neutral-700">
            You can give directly by M-Pesa or bank transfer, whether or not you
            have recorded a pledge.
          </p>

          <div className="mt-8">
            <PaymentInstructions />
          </div>
        </div>
      </section>

      <section className="bg-[#f8f7f5] px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto w-full max-w-5xl">
          <h2 className="text-2xl font-semibold tracking-tight text-navy sm:text-3xl">
            Contact
          </h2>

          <dl className="mt-6 grid gap-6 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-neutral-500">
                {CONTACT.leaderRole}
              </dt>
              <dd className="mt-1 text-base font-medium text-navy">
                {CONTACT.leaderName}
              </dd>
              <dd className="mt-1">
                <a
                  href={CONTACT.phoneHref}
                  className="tabular rounded text-base text-denim underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
                >
                  {CONTACT.phoneDisplay}
                </a>
              </dd>
            </div>

            <div>
              <dt className="text-sm text-neutral-500">{CONTACT.churchName}</dt>
              <dd className="mt-1 text-base text-neutral-700">
                {CONTACT.address}
              </dd>
              <dd className="mt-1">
                <Link
                  href={CONTACT.siteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded text-base text-denim underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
                >
                  {CONTACT.siteLabel}
                </Link>
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <FinalCta />
    </>
  );
}
