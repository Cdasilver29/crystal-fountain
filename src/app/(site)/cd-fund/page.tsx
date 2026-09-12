import type { Metadata } from "next";
import { Download } from "lucide-react";
import Link from "next/link";

import { PledgeCta } from "@/components/site/pledge-cta";
import { CD_FUND_PAGE } from "@/content/cd-fund";
import { FUND_SUMMARY } from "@/content/project";
import { pageMetadata } from "@/lib/metadata";

/*
 * The fund belongs to the church rather than to this campaign, so the title
 * ends in the church. The heading on the page keeps the "(CD-Fund)" the policy
 * document uses; a tab and a search result do not need the abbreviation too.
 */
export const metadata: Metadata = pageMetadata({
  title: { absolute: "Church Development Fund | Newlife SDA Church" },
  description:
    "The Newlife SDA Church Development Fund: what it may be spent on, where its money comes from, how it is invested, who governs it, and the controls that protect it.",
  path: "/cd-fund",
});

export default function CdFundPage() {
  return (
    <div className="bg-white">
      <header className="bg-navy px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto w-full max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-tight text-balance text-white sm:text-4xl">
            {CD_FUND_PAGE.title}
          </h1>

          <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/80">
            {CD_FUND_PAGE.tagline}
          </p>
        </div>
      </header>

      <main className="px-4 py-10 pb-16 sm:px-6 sm:py-14">
        <div className="mx-auto w-full max-w-3xl">
          <section>
            <h2 className="text-lg font-semibold tracking-tight text-navy">
              {CD_FUND_PAGE.introHeading}
            </h2>

            {CD_FUND_PAGE.intro.map((paragraph) => (
              <p
                key={paragraph.slice(0, 40)}
                className="mt-3 leading-relaxed text-neutral-700"
              >
                {paragraph}
              </p>
            ))}
          </section>

          <h2 className="mt-12 text-2xl font-semibold tracking-tight text-navy">
            {CD_FUND_PAGE.pillarsHeading}
          </h2>

          <div className="mt-6 space-y-8">
            {CD_FUND_PAGE.pillars.map((pillar) => (
              <section
                key={pillar.number}
                className="rounded-2xl border border-navy/10 bg-navy/[0.03] p-5 sm:p-6"
              >
                {/*
                  The number is a marker beside the heading rather than part of
                  it, so a screen reader reads the heading as the sentence it
                  is. min-w-0 on the text column is what stops a long heading
                  pushing the card wider than the phone it is read on.
                */}
                <div className="flex items-start gap-3.5">
                  <span
                    aria-hidden
                    className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-semibold text-white"
                  >
                    {pillar.number}
                  </span>

                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold tracking-tight text-balance text-navy">
                      {pillar.heading}
                    </h3>

                    <p className="mt-2 leading-relaxed text-neutral-700">
                      {pillar.lead}
                    </p>
                  </div>
                </div>

                <ul className="mt-4 space-y-2.5 sm:pl-[2.875rem]">
                  {pillar.bullets.map((bullet) => (
                    <li
                      key={bullet.text.slice(0, 40)}
                      className="flex gap-2.5 leading-relaxed text-neutral-700"
                    >
                      <span
                        aria-hidden
                        className="mt-[0.6rem] size-1.5 shrink-0 rounded-full bg-campfire"
                      />
                      <span className="min-w-0">
                        {bullet.term && (
                          <strong className="font-semibold text-navy">
                            {bullet.term}:{" "}
                          </strong>
                        )}
                        {bullet.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          {/*
            The printed summary, kept reachable from the page that replaced it
            in the navigation. A plain anchor, not a Link: the target is a file
            in public/, which the router has nothing to prefetch and no route
            to push.
          */}
          <div className="mt-10 rounded-2xl bg-navy/5 p-5">
            <a
              href={FUND_SUMMARY.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2.5 rounded font-medium text-denim underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
            >
              <Download aria-hidden className="size-4 shrink-0" />
              {FUND_SUMMARY.label}
            </a>

            <p className="mt-2 text-sm text-neutral-600">
              A printable summary of the fund, for sharing or for reading
              offline.
            </p>
          </div>

          <p className="mt-6 text-sm text-neutral-600">
            <Link
              href="/vision"
              className="rounded text-denim underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
            >
              See what the fund is building
            </Link>
          </p>
        </div>
      </main>

      <PledgeCta heading="Ready to pledge?" />
    </div>
  );
}
