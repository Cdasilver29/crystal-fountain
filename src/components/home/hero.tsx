import { FileText } from "lucide-react";
import Link from "next/link";

import { LiveTracker } from "@/components/campaign/live-tracker";
import { CAMPAIGN, SCRIPTURE } from "@/content/campaign";
import { CD_FUND } from "@/content/cd-fund";
import type { CampaignTotalsDto } from "@/lib/campaign";

/**
 * The hero.
 *
 * A campaign launch screen, not a dashboard. One warm colour, one action, and
 * the figure the congregation is watching set larger than anything else on the
 * page.
 *
 * Three layers behind the content, painted bottom up: the photograph, a heavy
 * navy overlay that takes the picture back far enough for white text and the
 * tracker to stay legible over any part of it, and then the radial wash, which
 * keeps its drifting highlight on top of both. Only the photograph is a
 * request, and it is the one image on the site loaded eagerly, because it is
 * the largest thing above the fold.
 *
 * The photograph is art directed: a wide crop of the model on a desktop, and a
 * square one on a phone, where a 16 by 9 picture in a full height section would
 * be reduced to a strip of its middle. That is what picture and source are for,
 * and it is why this one image is not a next/image. Two Image elements toggled
 * by a class would both be fetched, and this is the largest request on the page
 * for somebody opening a WhatsApp link on a phone. The files are converted and
 * sized ahead of time instead: two widths per crop, in avif, webp and jpeg.
 *
 * The encoder settings are deliberately aggressive, because of the overlay
 * below. Four fifths of every pixel on screen is flat navy and only one fifth
 * is the photograph, which flattens the picture's contrast and takes any
 * compression artefact down with it. The qualities were chosen by compositing
 * each candidate under that overlay and measuring the difference in the result
 * rather than in the file, which is how a 720px crop that a phone downloads
 * went from 104 kB to 29 kB with nothing visible to show for it. If the overlay
 * is ever lightened, the images need re-encoding at a higher quality, because
 * the headroom they are trading on is the overlay itself.
 *
 * It covers the section rather than fitting inside it. The section is a full
 * 100svh and no photograph is that shape, so a band of the picture is what
 * shows, which is what a backdrop under an 80 per cent overlay is for. Fitting
 * the whole picture in was tried and put a visible rectangle across the hero.
 *
 * The section isolates, which keeps the z-10 on the content local to it. Left
 * unscoped that 10 competed with the fixed header's own z-10 at page level and,
 * being later in the document, won: the phone menu opened behind the hero copy.
 */
export function Hero({
  totals,
  sparkline,
}: {
  totals: CampaignTotalsDto;
  sparkline?: React.ReactNode;
}) {
  return (
    <section
      id="hero"
      className="relative isolate -mt-16 flex min-h-[100svh] flex-col overflow-hidden bg-navy px-4 pt-16 pb-24 sm:px-6"
    >
      {/*
        Order matters and is not alphabetical. A browser takes the first source
        whose media and type it can satisfy, so the widescreen crop has to come
        before the square one and, within each crop, the formats have to run
        newest first. Putting the jpeg first would mean nobody ever sees the
        avif.
      */}
      <picture>
        <source
          media="(min-width: 768px)"
          type="image/avif"
          srcSet="/images/gallery/hero-desktop-1100.avif 1100w, /images/gallery/hero-desktop.avif 1672w"
          sizes="100vw"
        />
        <source
          media="(min-width: 768px)"
          type="image/webp"
          srcSet="/images/gallery/hero-desktop-1100.webp 1100w, /images/gallery/hero-desktop.webp 1672w"
          sizes="100vw"
        />
        <source
          media="(min-width: 768px)"
          srcSet="/images/gallery/hero-desktop-1100.jpg 1100w, /images/gallery/hero-desktop.jpg 1672w"
          sizes="100vw"
        />

        <source
          type="image/avif"
          srcSet="/images/gallery/hero-mobile-720.avif 720w, /images/gallery/hero-mobile.avif 1254w"
          sizes="100vw"
        />
        <source
          type="image/webp"
          srcSet="/images/gallery/hero-mobile-720.webp 720w, /images/gallery/hero-mobile.webp 1254w"
          sizes="100vw"
        />
        <source
          srcSet="/images/gallery/hero-mobile-720.jpg 720w, /images/gallery/hero-mobile.jpg 1254w"
          sizes="100vw"
        />

        <img
          src="/images/gallery/hero-desktop.jpg"
          alt=""
          fetchPriority="high"
          decoding="async"
          className="absolute inset-0 size-full object-cover object-center"
        />
      </picture>

      <div aria-hidden className="absolute inset-0 bg-navy/80" />

      <div
        aria-hidden
        className="hero-wash pointer-events-none absolute inset-0"
      />

      <div className="hero-lift-soft relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center py-8 text-center">
        <p className="hero-lift text-xl font-extrabold tracking-tight text-balance text-campfire sm:text-3xl">
          {CAMPAIGN.tagline}
        </p>

        <h1 className="hero-lift mt-3 text-3xl font-bold tracking-tight text-balance text-white sm:text-5xl">
          {CAMPAIGN.name}
        </h1>

        <p className="mt-3 text-base text-balance text-white/80 sm:text-xl">
          {CAMPAIGN.subheading}
        </p>

        {/*
          The card breaks out of the hero's side padding on a phone, so it
          reaches about 95% of a 360px screen rather than the 91% the padding
          would otherwise leave it. Only the tracker does this: it is the one
          element meant to read as a panel sitting on the page rather than as
          part of the centred column of copy. It still stops 8px short of the
          viewport edge, so nothing overflows.
        */}
        <div className="-mx-2 mt-12 sm:mx-0 sm:mt-16">
          <LiveTracker initial={totals} sparkline={sparkline} />
        </div>

        {/*
          One action, and a way out for somebody who is not ready to take it.
          The pledge button keeps the only warm colour and its full width on a
          phone; the FAQ sits beside it outlined, so a member with a question
          has somewhere to go that is not the back button.
        */}
        <div className="mt-11 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center sm:gap-4">
          <Link
            href="/pledge"
            className="inline-flex h-14 items-center justify-center rounded-xl bg-campfire px-10 text-lg font-semibold text-white transition-colors hover:bg-[#ef7433] focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-navy focus-visible:outline-none"
          >
            Make a pledge
          </Link>

          <Link
            href="/faq"
            className="inline-flex h-14 items-center justify-center rounded-xl border border-white/30 px-6 text-base font-medium text-white transition-colors hover:border-white/60 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-navy focus-visible:outline-none sm:px-8 sm:text-lg"
          >
            Frequently asked questions
          </Link>
        </div>

        {/*
          The fund policy, set under the row rather than in it. A third button
          the size of the other two pushed the group past the width of the copy
          above it on a laptop and made the hero read as a toolbar, so this is a
          link with an icon: reachable, and not competing with the one warm
          button on the page.

          It used to serve the printed summary straight out of public/. That PDF
          is now offered from the page this points at, so the hero hands a
          reader the whole policy rather than a download.
        */}
        <div className="mt-5 flex justify-center">
          <Link
            href={CD_FUND.href}
            className="inline-flex h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-white/80 underline-offset-4 transition-colors hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-navy focus-visible:outline-none sm:text-base"
          >
            <FileText aria-hidden className="size-4 shrink-0" />
            {CD_FUND.label}
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
        className="absolute inset-x-0 bottom-6 z-10 mx-auto flex size-10 items-center justify-center rounded-full text-white/70 hover:text-white focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
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
