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
      className="relative isolate -mt-16 flex min-h-[100svh] flex-col overflow-hidden bg-navy page-gutter pt-16 pb-24 lg:pb-32"
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

        {/*
          Eager and high priority, both said explicitly.

          This is the largest thing above the fold and the one image on the site
          that must not wait. loading="eager" is the default for an img, but an
          img inside a picture with six sources is exactly the kind of markup a
          later edit turns lazy by habit, and writing the default down is
          cheaper than finding out from a field report that the hero paints
          grey for a second on a Nairobi 3G connection.
        */}
        <img
          src="/images/gallery/hero-desktop.jpg"
          alt=""
          loading="eager"
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

      {/*
        The last stretch of the hero settles onto solid navy.

        The recent pledges band below is flat navy and the photograph under the
        overlay is not: measured at the join, the picture was still coming
        through at rgb(54, 77, 116) against the band's rgb(5, 34, 82), which
        drew a hard line across the page exactly where the two are meant to
        read as one surface. Fading the last 160px to the same navy the band
        uses means they meet at the same colour and there is no join to see.

        Interpolated from navy at zero alpha rather than from transparent, so
        the ramp stays in this hue instead of passing through a muddy grey.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-navy/0 to-navy"
      />

      <div className="hero-lift-soft relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center py-8 text-center">
        <p className="font-display hero-lift text-xl font-bold text-balance text-campfire sm:text-3xl">
          {CAMPAIGN.tagline}
        </p>

        <h1 className="font-display hero-lift mt-3 text-3xl leading-tight font-bold text-balance text-white sm:text-5xl sm:leading-[1.1] sm:tracking-[-0.01em]">
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
            className="btn-primary cta-sweep inline-flex h-14 [--sweep-delay:1.3s] items-center justify-center bg-campfire px-10 text-lg font-semibold text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-navy focus-visible:outline-none"
          >
            Make a pledge
          </Link>

          <Link
            href="/faq"
            className="btn-secondary inline-flex h-14 items-center justify-center border border-white/30 px-6 text-base font-medium text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-navy focus-visible:outline-none sm:px-8 sm:text-lg"
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

        {/*
          The verse, set as a quiet card rather than loose text.

          A hairline rule above it and a soft translucent panel give it an edge
          to sit against, so it reads as a deliberate closing note instead of a
          caption that drifted to the bottom of the hero. The reference goes on
          its own line under a short divider, which is what separates a citation
          from the sentence it belongs to without needing a heavier weight.
        */}
        <blockquote
          data-spring=""
          className="relative mx-auto mt-12 max-w-xl rounded-2xl border border-white/10 bg-white/[0.04] px-6 py-7 backdrop-blur-[2px] sm:px-8">
          <span
            aria-hidden
            className="absolute inset-x-0 -top-px mx-auto h-px w-24 bg-gradient-to-r from-transparent via-campfire/70 to-transparent"
          />

          <p className="text-base leading-relaxed text-balance text-white/85 italic sm:text-lg">
            {SCRIPTURE.text}
          </p>

          {/* Sentence case, per the copy rules. The spacing does the work. */}
          <cite className="mt-4 flex items-center justify-center gap-3 text-sm font-medium tracking-[0.12em] text-campfire/90 not-italic">
            <span aria-hidden className="h-px w-6 bg-campfire/40" />
            {SCRIPTURE.reference}
            <span aria-hidden className="h-px w-6 bg-campfire/40" />
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
