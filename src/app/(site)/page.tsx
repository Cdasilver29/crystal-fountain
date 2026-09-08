import type { Metadata } from "next";

import { PaymentInstructions } from "@/components/campaign/payment-instructions";
import { Accountability } from "@/components/home/accountability";
import { BrochureGallery } from "@/components/home/brochure-gallery";
import { FinalCta } from "@/components/home/final-cta";
import { Hero } from "@/components/home/hero";
import { JourneyTimeline } from "@/components/home/journey-timeline";
import { KeyNumbers } from "@/components/home/key-numbers";
import { VisionSection } from "@/components/home/vision-section";
import { CAMPAIGN } from "@/content/campaign";
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
      <BrochureGallery />

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

      <Accountability />

      <FinalCta />
    </>
  );
}
