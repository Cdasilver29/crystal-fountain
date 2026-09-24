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
import { RevealOnScroll } from "@/components/motion/reveal-on-scroll";
import { JsonLd } from "@/components/seo/json-ld";
import { CAMPAIGN, CONTACT } from "@/content/campaign";
import { db } from "@/db";
import {
  CAMPAIGN_SLUG,
  getCampaignTotals,
  getCommitmentBandCounts,
  getRecentPledges,
} from "@/lib/campaign";
import { pageMetadata } from "@/lib/metadata";
import { paymentDetails } from "@/lib/payment-details";
import { organizationSchema, websiteSchema } from "@/lib/structured-data";
import * as snapshots from "@/server/services/snapshots";

export const dynamic = "force-dynamic";

/*
 * The one title on the site that does not end in the campaign name, because it
 * starts with it. What a stranger searching for this needs after the bar is
 * the church and the city, which is what tells them this is their church.
 */
export const metadata: Metadata = pageMetadata({
  title: { absolute: `${CAMPAIGN.name} | ${CONTACT.churchName} Nairobi` },
  description:
    "Make your pledge toward a new sanctuary for Newlife SDA Church. KES 550M target.",
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
  const [totals, recent, recentPledges, details, bandCounts] =
    await Promise.all([
      getCampaignTotals(),
      snapshots.series(db, { campaignSlug: CAMPAIGN_SLUG, days: 30 }),
      getRecentPledges(),
      paymentDetails(),
      getCommitmentBandCounts(),
    ]);

  return (
    <>
      {/*
        Structured data for the site as a whole, emitted here and only here.

        The church and this site do not change from page to page, so describing
        them once on the page every share link lands on is enough. Repeating
        the same two blocks under the site layout would put them on all nine
        public pages and give a crawler nine copies to reconcile.
      */}
      <JsonLd data={organizationSchema()} />
      <JsonLd data={websiteSchema()} />

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
        Directly under the hero and on the same navy, with no band of its own,
        because the figure above says what the congregation has done together
        and this says who is doing it. Given a white background and a section
        heading it competed with the tracker; kept as three drifting lines on
        the same colour it reads as the tracker's last line, which is what it
        is. The case for why still follows both.
      */}
      <RecentPledges
        initial={recentPledges}
        renderedAt={new Date().toISOString()}
      />
      <VisionSection />
      <TargetedCommitment
        targetMinor={totals.targetMinor}
        bandCounts={bandCounts}
      />
      <JourneyTimeline />
      <BrochureGallery />

      <section className="bg-white page-gutter section">
        <div data-reveal="" className="container-marketing">
          <h2 className="text-2xl font-semibold tracking-tight text-navy sm:text-3xl">
            How to give
          </h2>
          <p className="container-prose mx-0 mt-2 text-base leading-relaxed text-neutral-700">
            You can give directly by M-Pesa or bank transfer, whether or not you
            have recorded a pledge.
          </p>

          <div className="mt-6">
            <PaymentInstructions details={details} showContact={false} />
          </div>
        </div>
      </section>

      <Accountability />

      <FinalCta />

      {/*
        Arms the section reveals below the fold. Renders nothing; the sections
        above carry data-reveal and are complete without it.
      */}
      <RevealOnScroll />
    </>
  );
}
