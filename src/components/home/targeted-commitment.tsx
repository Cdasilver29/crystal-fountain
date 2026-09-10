import Link from "next/link";

import {
  COMMITMENT_COPY,
  COMMITMENT_TIERS,
  PLEDGE_STEPS,
} from "@/content/project";
import { formatKESCompact, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The targeted commitment guide, on navy.
 *
 * This replaced the four key numbers, which described the building. This
 * describes what the congregation has to do, which is the more useful thing to
 * put in front of somebody deciding what to pledge: nine ways to reach the
 * target, and the per family figure each one asks for.
 *
 * One list, two shapes. Nine full width rows read as a long ledger on a wide
 * screen, so from the small breakpoint up the same items become a three by
 * three grid of cards: a third of the height, and the nine options are taken in
 * at a glance rather than scrolled. On a phone they stay a single column of
 * rows, families on the left and the figure on the right, under a pair of
 * column labels that do the work the table header used to do.
 *
 * The total is the same on every row, so it is stated once beside the heading
 * instead of nine times down a column, and it is read from the database.
 */
export function TargetedCommitment({ targetMinor }: { targetMinor: string }) {
  // The target is read from the database and formatted here. It is never
  // written into the content file, per CLAUDE.md. A whole compact figure loses
  // its trailing zero, so it reads "KES 550M" as the flyer does rather than
  // "KES 550.0M", without pinning the number to 550 of anything.
  const total = formatKESCompact(targetMinor).replace(/\.0([KMB])$/, "$1");

  return (
    <section className="bg-navy px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-balance text-white sm:text-3xl">
              {COMMITMENT_COPY.heading}
            </h2>
            <p className="mt-2 text-base text-white/60">
              {COMMITMENT_COPY.subheading}
            </p>
          </div>

          {/*
            The figure every row adds up to. It belongs beside the heading
            rather than repeated down a column, and it is the one number in this
            section that comes from the database rather than the flyer.
          */}
          <p className="shrink-0 self-start rounded-xl bg-white/5 px-4 py-3 ring-1 ring-white/10 sm:self-auto">
            <span className="tabular block text-lg font-semibold text-white sm:text-xl">
              {total}
            </span>
            <span className="mt-0.5 block text-xs text-white/50">
              campaign target
            </span>
          </p>
        </div>

        {/*
          Pray, pledge, redeem. Three steps off the flyer, each carrying one of
          the church's colours. The numeral is the coloured element and the word
          stays white, because a denim pill on navy would be a shape a reader
          has to work at rather than read.
        */}
        <ol className="mt-8 flex flex-wrap items-center gap-x-2 gap-y-2">
          {PLEDGE_STEPS.map((step, index) => (
            <li
              key={step.label}
              className="flex items-center gap-1.5 rounded-full bg-white/5 py-1.5 pr-3 pl-1 ring-1 ring-white/10"
            >
              <span
                aria-hidden
                className={cn(
                  "tabular flex size-6 items-center justify-center rounded-full text-xs font-semibold text-white",
                  index === 0 && "bg-campfire",
                  index === 1 && "bg-treefrog",
                  index === 2 && "bg-denim",
                )}
              >
                {step.step}
              </span>
              <span className="text-sm font-medium text-white">
                {step.label}
              </span>
            </li>
          ))}
        </ol>

        {/* The column labels the phone layout needs and the grid does not. */}
        <div className="mt-8 flex items-baseline justify-between border-b border-white/15 pb-2 text-xs text-white/40 sm:hidden">
          <span>Families</span>
          <span>Pledge per family</span>
        </div>

        <ol className="sm:mt-8 sm:grid sm:grid-cols-2 sm:gap-3 md:grid-cols-3">
          {COMMITMENT_TIERS.map((tier) => (
            <li
              key={tier.families}
              className={cn(
                // Phone: a row on a divider. Small and up: a card.
                "flex items-baseline justify-between gap-3 border-b border-white/10 py-3.5",
                "sm:block sm:rounded-xl sm:border sm:border-white/10 sm:px-4 sm:py-4",
                tier.sweetSpot &&
                  "border-l-2 border-l-campfire pl-2.5 sm:border-l sm:border-campfire/60 sm:bg-campfire/10 sm:pl-4",
              )}
            >
              <p className="text-sm text-white/60 sm:mb-1 sm:flex sm:items-center sm:justify-between sm:gap-2 sm:text-xs sm:text-white/50">
                {/*
                  Built as one string rather than an expression beside literal
                  text, so the figure and its unit reach the page as a single
                  text node instead of being split by a comment marker.
                */}
                <span>
                  {tier.sweetSpot && <span className="sr-only">Sweet spot. </span>}
                  {`${formatNumber(tier.families)} families`}
                </span>
                {tier.sweetSpot && (
                  <span
                    aria-hidden
                    className="hidden shrink-0 rounded-full bg-campfire/20 px-2 py-0.5 text-[10px] font-medium text-campfire sm:inline-block"
                  >
                    Sweet spot
                  </span>
                )}
              </p>

              <p className="tabular text-base font-semibold text-campfire sm:text-xl lg:text-2xl">
                {`KES ${formatNumber(tier.pledgePerFamilyKes)}`}
              </p>

              <p className="hidden text-xs text-white/40 sm:mt-0.5 sm:block">
                per family
              </p>
            </li>
          ))}
        </ol>

        <p className="mt-6 text-sm text-white/40 sm:hidden">
          The rows marked in campfire are the range the campaign is planning
          around.
        </p>

        <p className="mt-8 text-base text-white/70">
          {COMMITMENT_COPY.cta}{" "}
          <Link
            href="/pledge"
            className="rounded font-medium text-campfire underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
          >
            {COMMITMENT_COPY.ctaLink}
            <span aria-hidden> &rarr;</span>
          </Link>
        </p>
      </div>
    </section>
  );
}
