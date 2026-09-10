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
 * The pledge per family column is the one that matters, so it is the largest
 * type in the section and the only column set in campfire. The families count
 * and the total are deliberately quiet: the total is the same on every row, and
 * a member is not choosing between totals.
 *
 * It is a real table, not a grid of divs, because it is a real table: three
 * headed columns of comparable figures. At 360px the three columns still fit
 * inside the page, so nothing scrolls sideways and nothing has to be restacked
 * into cards that would lose the comparison down the column.
 */
export function TargetedCommitment({ targetMinor }: { targetMinor: string }) {
  // The target is read from the database and formatted here. It is never
  // written into the content file, per CLAUDE.md. A whole compact figure loses
  // its trailing zero, so the column reads "KES 550M" as the flyer does rather
  // than "KES 550.0M", without pinning the number to 550 of anything.
  const total = formatKESCompact(targetMinor).replace(/\.0([KMB])$/, "$1");

  return (
    <section className="bg-navy px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto w-full max-w-3xl">
        <h2 className="text-2xl font-semibold tracking-tight text-balance text-white sm:text-3xl">
          {COMMITMENT_COPY.heading}
        </h2>
        <p className="mt-2 text-base text-white/60">
          {COMMITMENT_COPY.subheading}
        </p>

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

        <table className="mt-8 w-full border-collapse text-left">
          <caption className="sr-only">
            {COMMITMENT_COPY.heading}. {COMMITMENT_COPY.subheading}. Every row
            reaches the same target of {total}.
          </caption>

          <thead>
            <tr className="border-b border-white/15">
              <th
                scope="col"
                className="px-2 pb-3 text-xs font-medium text-white/50 sm:px-4"
              >
                Families
              </th>
              <th
                scope="col"
                className="px-2 pb-3 text-xs font-medium text-white/50 sm:px-4"
              >
                Pledge per family
              </th>
              <th
                scope="col"
                className="px-2 pb-3 text-right text-xs font-medium text-white/50 sm:px-4"
              >
                Total
              </th>
            </tr>
          </thead>

          <tbody>
            {COMMITMENT_TIERS.map((tier) => (
              <tr
                key={tier.families}
                className={cn(
                  "border-b border-white/10",
                  tier.sweetSpot && "bg-campfire/10",
                )}
              >
                {/*
                  The accent sits on the left edge of the first cell rather than
                  on the row, so it reads as a marker on the row it belongs to
                  and does not shift any column.
                */}
                <th
                  scope="row"
                  className={cn(
                    "tabular px-2 py-4 align-top text-base font-normal text-white/70 sm:px-4 sm:py-5",
                    tier.sweetSpot &&
                      "border-l-2 border-l-campfire pl-1.5 sm:pl-3.5",
                  )}
                >
                  {formatNumber(tier.families)}
                </th>

                <td className="px-2 py-4 align-top sm:px-4 sm:py-5">
                  <span className="tabular block text-base font-semibold text-campfire sm:text-lg">
                    {guideAmount(tier.pledgePerFamilyKes)}
                  </span>
                  {tier.sweetSpot && (
                    <span className="mt-1 block text-[11px] font-medium text-white/60">
                      Sweet spot
                    </span>
                  )}
                </td>

                <td className="tabular px-2 py-4 text-right align-top text-xs text-white/40 sm:px-4 sm:py-5 sm:text-sm">
                  {total}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

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

/**
 * A guide figure in whole shillings, written out in full with the currency.
 *
 * These are not money totals. They are printed guide numbers from the campaign
 * material, so they arrive as plain whole shillings rather than minor units and
 * never reach a money code path. formatKES is not used for that reason: it
 * takes minor units, and converting these to minor units just to divide them
 * back would suggest they are amounts the system holds.
 */
function guideAmount(shillings: number): string {
  return `KES ${formatNumber(shillings)}`;
}
