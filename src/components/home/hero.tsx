import Link from "next/link";

import { LiveTracker } from "@/components/campaign/live-tracker";
import { CAMPAIGN, SCRIPTURE } from "@/content/campaign";
import type { CampaignTotalsDto } from "@/lib/campaign";

/**
 * The hero.
 *
 * A campaign launch screen, not a dashboard. One warm colour, one action, and
 * the figure the congregation is watching set larger than anything else on the
 * page. The wash behind it is a single radial gradient, so the whole screen
 * costs no extra request.
 */
export function Hero({ totals }: { totals: CampaignTotalsDto }) {
  return (
    <section
      id="hero"
      className="hero-wash relative -mt-16 flex min-h-[100svh] flex-col bg-navy px-4 pt-16 pb-24 sm:px-6"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center py-8 text-center">
        <p className="text-xl font-extrabold tracking-tight text-balance text-campfire sm:text-3xl">
          {CAMPAIGN.tagline}
        </p>

        <h1 className="mt-3 text-3xl font-bold tracking-tight text-balance text-white sm:text-5xl">
          {CAMPAIGN.name}
        </h1>

        <p className="mt-3 text-base text-balance text-white/80 sm:text-xl">
          {CAMPAIGN.subheading}
        </p>

        <div className="mt-12 text-left sm:mt-16">
          <LiveTracker initial={totals} />
        </div>

        <div className="mt-11">
          <Link
            href="/pledge"
            className="inline-flex h-14 items-center justify-center rounded-xl bg-campfire px-10 text-lg font-semibold text-white transition-colors hover:bg-[#ef7433] focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-navy focus-visible:outline-none"
          >
            Make a pledge
          </Link>
        </div>

        <blockquote className="mx-auto mt-10 max-w-xl">
          <p className="text-sm leading-relaxed text-balance text-white/70 italic">
            {SCRIPTURE.text}
          </p>
          <cite className="mt-1.5 block text-sm text-white/50 not-italic">
            {SCRIPTURE.reference}
          </cite>
        </blockquote>
      </div>

      <a
        href="#vision"
        aria-label="Skip to what is being built"
        className="absolute inset-x-0 bottom-6 mx-auto flex size-10 items-center justify-center rounded-full text-white/70 hover:text-white focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="scroll-hint size-6"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </a>
    </section>
  );
}
