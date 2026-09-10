import type { Metadata } from "next";

import { PaymentInstructions } from "@/components/campaign/payment-instructions";
import { Sparkline } from "@/components/campaign/sparkline";
import { Accountability } from "@/components/home/accountability";
import { BrochureGallery } from "@/components/home/brochure-gallery";
import { FinalCta } from "@/components/home/final-cta";
import { Hero } from "@/components/home/hero";
import { JourneyTimeline } from "@/components/home/journey-timeline";
import { RecentPledges } from "@/components/home/recent-pledges";
import { TargetedCommitment } from "@/components/home/targeted-commitment";
import { VisionSection } from "@/components/home/vision-section";
import { CAMPAIGN } from "@/content/campaign";
import { db } from "@/db";
import {
  CAMPAIGN_SLUG,
  getCampaignTotals,
  getRecentPledges,
} from "@/lib/campaign";
import { pageMetadata } from "@/lib/metadata";
import * as snapshots from "@/server/services/snapshots";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: CAMPAIGN.name,
  path: "/",
});

export default async function HomePage() {
  // Read on the server so the first paint carries real numbers and the page is
  // correct with JavaScript disabled. LiveTracker takes over after hydration.
  //
  // The sparkline is rendered here too, on the server, and handed to the hero
  // as an element. Drawing it in the client component would ship the drawing
  // code to a browser for a picture that never changes after first paint, and
  // this is the page most people arrive on.
  const [totals, recent, recentPledges] = await Promise.all([
    getCampaignTotals(),
    snapshots.series(db, { campaignSlug: CAMPAIGN_SLUG, days: 30 }),
    getRecentPledges(),
  ]);

  return (
    <>
      <Hero
        totals={totals}
        sparkline={
          <Sparkline
            className="h-10 w-full"
            values={recent.map((day) => day.pledgedMinor.toString())}
          />
        }
      />
      {/*
        Between the tracker and the vision, because the figure above says what
        the congregation has done together and this says who is doing it, and
        both belong before the case for why.
      */}
      <RecentPledges
        initial={recentPledges}
        renderedAt={new Date().toISOString()}
      />
      <VisionSection />
      <TargetedCommitment targetMinor={totals.targetMinor} />
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
            <PaymentInstructions showContact={false} />
          </div>
        </div>
      </section>

      <Accountability />

      <FinalCta />
    </>
  );
}
