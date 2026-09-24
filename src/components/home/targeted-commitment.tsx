import Link from "next/link";

import {
  COMMITMENT_COPY,
  COMMITMENT_TIERS,
  PLEDGE_STEPS,
  type CommitmentTier,
} from "@/content/project";
import { formatKESCompact, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import { MoreLevels } from "./more-levels";

/**
 * The targeted commitment guide, on navy.
 *
 * It opens on one figure rather than a heading: the lead level at display
 * size, so a household has somewhere obvious to place itself before it reads
 * a word. The question follows, then the other two featured levels as cards,
 * and the remaining six one tap away in a details element that opens in place
 * and needs no JavaScript to do it.
 *
 * Every level is a link into the pledge form with its amount already chosen,
 * so a member who settles on one does not have to carry the number across and
 * type it in. The amount travels in minor units and the form validates it
 * again like any other input.
 *
 * Under each card is how many pledges already sit at that level, read from the
 * database. Where there are fewer than three the service returns nothing, and
 * nothing is shown, so a small count cannot be matched against the public list.
 */
export function TargetedCommitment({
  targetMinor,
  bandCounts,
}: {
  targetMinor: string;
  /** Pledges per level in COMMITMENT_TIERS order, null where withheld. */
  bandCounts: readonly (number | null)[];
}) {
  // The target is read from the database and formatted here. It is never
  // written into the content file, per CLAUDE.md. A whole compact figure loses
  // its trailing zero, so it reads "KES 550M" as the flyer does rather than
  // "KES 550.0M", without pinning the number to 550 of anything.
  const total = formatKESCompact(targetMinor).replace(/\.0([KMB])$/, "$1");
  // The same figure in words for the sentence under the heading, where
  // "KES 550 million" reads better than the abbreviation.
  const totalInWords = total.replace(/M$/, " million").replace(/B$/, " billion");

  const tiers = COMMITMENT_TIERS.map((tier, index) => ({
    tier,
    count: bandCounts[index] ?? null,
  }));
  const lead = tiers.find(({ tier }) => tier.lead);
  // The lead level is drawn on its own at display size, so the cards below
  // carry the other two featured levels and the details carry the rest.
  const featured = tiers.filter(({ tier }) => tier.featured && !tier.lead);
  const rest = tiers.filter(({ tier }) => !tier.featured);

  return (
    <section
      aria-labelledby="commitment-heading"
      className="bg-navy page-gutter section"
    >
      <div className="container-marketing">
        {/*
          The section opens on one figure rather than a heading: the lead
          level, the second largest thing on the page after the hero total.
          It is a link like every other level, into the form with its amount
          chosen.
        */}
        {lead && <LeadLevel tier={lead.tier} count={lead.count} />}

        <div
          data-reveal=""
          className="mt-12 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-8"
        >
          <div>
            <h2
              id="commitment-heading"
              className="text-xl font-semibold tracking-tight text-balance text-white sm:text-2xl"
            >
              {COMMITMENT_COPY.heading}
            </h2>
            <p className="mt-2 max-w-xl text-base text-pretty text-white/60">
              {COMMITMENT_COPY.subheading(totalInWords)}
            </p>
          </div>

          {/*
            The figure every level adds up to, and the one number in this
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
          Pray, pledge, redeem, as one path rather than three separate pills:
          a line runs behind the numbered markers the way the roadmap on
          /vision joins its steps. The markers carry the church's colours and a
          navy ring, which is what cuts the line where it passes behind them.

          The line runs from the centre of the first column to the centre of
          the last, a sixth of the width in from each side, so it starts and
          stops on a marker rather than at the edge of the row.
        */}
        <div data-reveal="" className="relative mt-8">
          <div
            aria-hidden
            className="absolute top-4 right-[16.667%] left-[16.667%] h-0.5 -translate-y-1/2 rounded-full bg-white/20"
          />
          <ol className="relative grid grid-cols-3 gap-3 sm:gap-6">
            {PLEDGE_STEPS.map((step, index) => (
              <li
                key={step.label}
                className="flex flex-col items-center text-center"
              >
                <span
                  aria-hidden
                  className={cn(
                    "tabular flex size-8 items-center justify-center rounded-full text-sm font-semibold text-white ring-4 ring-navy",
                    index === 0 && "bg-campfire",
                    index === 1 && "bg-treefrog",
                    index === 2 && "bg-denim",
                  )}
                >
                  {step.step}
                </span>
                <span className="mt-3 text-sm font-semibold text-white sm:text-base">
                  {step.label}
                </span>
                <span className="mt-1 text-xs leading-snug text-pretty text-white/60 sm:text-sm">
                  {step.detail}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <ol
          data-reveal=""
          data-stagger=""
          className="mt-10 grid grid-cols-2 gap-3 md:grid-cols-3"
        >
          {featured.map(({ tier, count }) => (
            <li key={tier.families}>
              <LevelCard tier={tier} count={count} />
            </li>
          ))}
        </ol>

        <p className="mt-4 text-sm text-white/50">
          {COMMITMENT_COPY.sweetSpotNote}
        </p>

        <MoreLevels id="all-levels" label={COMMITMENT_COPY.expand}>
          <ol className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {rest.map(({ tier, count }) => (
              <li key={tier.families}>
                <LevelCard tier={tier} count={count} />
              </li>
            ))}
          </ol>
        </MoreLevels>

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

/** The pledge form with this level's amount chosen, in minor units. */
function pledgeHref(tier: CommitmentTier): string {
  // Built as a bigint so the conversion is exact.
  return `/pledge?amount=${(BigInt(tier.pledgePerFamilyKes) * 100n).toString()}`;
}

/**
 * The lead level, set as the figure the section opens on.
 *
 * Sized against the hero total: clamp(2rem, 8.5vw, 4rem) against its
 * clamp(2rem, 9vw, 4.5rem), so it is never the larger of the two and always
 * larger than anything else on the page.
 */
function LeadLevel({
  tier,
  count,
}: {
  tier: CommitmentTier;
  count: number | null;
}) {
  return (
    <Link
      data-reveal=""
      href={pledgeHref(tier)}
      className="card-lift group -mx-3 block w-fit max-w-full rounded-2xl px-3 py-2 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
    >
      <span className="tabular block font-semibold tracking-tight whitespace-nowrap text-campfire [font-size:clamp(2rem,8.5vw,4rem)] [line-height:1.05]">
        {`KES ${formatNumber(tier.pledgePerFamilyKes)}`}
      </span>

      <span className="mt-3 block max-w-md text-base text-pretty text-white/80 sm:text-lg">
        {COMMITMENT_COPY.leadLine(formatNumber(tier.families))}
        {tier.sweetSpot && (
          <>
            {" "}
            <span className="ml-1 inline-block rounded-full bg-campfire/20 px-2 py-0.5 align-middle text-[10px] font-medium text-campfire">
              Sweet spot
            </span>
          </>
        )}
      </span>

      {count !== null && (
        <span className="mt-2 block text-sm text-white/60">
          {`${formatNumber(count)} families at this level`}
        </span>
      )}

      <span className="mt-4 block text-sm font-medium text-white/60 transition-colors group-hover:text-white">
        Pledge this amount <span aria-hidden>&rarr;</span>
      </span>
    </Link>
  );
}

/** One level, as a link into the pledge form with its amount chosen. */
function LevelCard({
  tier,
  count,
}: {
  tier: CommitmentTier;
  count: number | null;
}) {
  return (
    <Link
      href={pledgeHref(tier)}
      className={cn(
        // Two to a row on a phone leaves about 150px a card, so the side
        // padding comes in until the small breakpoint to keep the widest
        // figure, KES 10,000,000, on one line.
        "card-lift group block h-full rounded-xl border px-3 py-4 sm:px-4",
        "focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none",
        tier.sweetSpot
            ? "border-campfire/50 bg-campfire/5 hover:bg-campfire/10"
            : "border-white/10 bg-white/5 hover:border-white/25 hover:bg-white/10",
      )}
    >
      <span className="flex items-center justify-between gap-2 text-xs text-white/60">
        {/*
          Built as one string rather than an expression beside literal text, so
          the figure and its unit reach the page as a single text node.
        */}
        <span>{`${formatNumber(tier.families)} families`}</span>
        {tier.sweetSpot && (
          <>
            {" "}
            <span className="shrink-0 rounded-full bg-campfire/20 px-2 py-0.5 text-[10px] font-medium text-campfire">
              Sweet spot
            </span>
          </>
        )}
      </span>

      <span
        className="tabular mt-1 block text-base font-semibold whitespace-nowrap text-campfire sm:text-xl"
      >
        {`KES ${formatNumber(tier.pledgePerFamilyKes)}`}
      </span>

      {count !== null && (
        <span className="mt-1 block text-xs text-white/60">
          {`${formatNumber(count)} families at this level`}
        </span>
      )}

      <span className="mt-3 block text-xs font-medium whitespace-nowrap text-white/50 transition-colors group-hover:text-white">
        Pledge this amount <span aria-hidden>&rarr;</span>
      </span>
    </Link>
  );
}
