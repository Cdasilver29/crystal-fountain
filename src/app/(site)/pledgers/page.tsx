import type { Metadata } from "next";
import Link from "next/link";

import { PledgersList } from "@/components/pledgers/pledgers-list";
import { db } from "@/db";
import { CAMPAIGN_SLUG } from "@/lib/campaign";
import { formatNumber } from "@/lib/format";
import { pageMetadata } from "@/lib/metadata";
import * as publicPledgers from "@/server/services/public-pledgers";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "Pledgers",
  description:
    "Members and well-wishers who have recorded a pledge toward the Crystal Fountain Development Project and asked to be named.",
  path: "/pledgers",
});

/**
 * The record of who has pledged.
 *
 * The drifting band on the home page is atmosphere: three lines, moving, meant
 * to be glanced at. This is the list, and the point of it is being findable.
 * Somebody types their own first name and sees their pledge, which is why the
 * search box sits above the rows rather than behind a filter menu.
 *
 * The first page is rendered here, on the server, so the record is readable
 * with JavaScript switched off and the page is right on first paint. The client
 * takes over for searching and for the pages after this one.
 *
 * Both counts are shown and the gap between them is explained in a line. A list
 * of a hundred and eighty names under a campaign that has recorded four hundred
 * pledges invites exactly one question, and leaving the congregation to guess
 * the answer would be worse than the question.
 */
export default async function PledgersPage() {
  const [page, counts] = await Promise.all([
    publicPledgers.publicList(db, { campaignSlug: CAMPAIGN_SLUG }),
    publicPledgers.publicCounts(db, { campaignSlug: CAMPAIGN_SLUG }),
  ]);

  return (
    <div className="bg-white">
      <header className="bg-navy px-4 py-10 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-tight text-white">
            Pledgers
          </h1>
          <p className="mt-2 text-white/70">
            Members and well-wishers who have recorded a pledge and asked to be
            named.
          </p>

          <div className="mt-6 flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <p className="text-white">
              <span className="tabular text-2xl font-semibold">
                {formatNumber(counts.recorded)}
              </span>{" "}
              <span className="text-white/70">
                {counts.recorded === 1 ? "pledge" : "pledges"} recorded
              </span>
            </p>
            <p className="text-white">
              <span className="tabular text-2xl font-semibold">
                {formatNumber(counts.shown)}
              </span>{" "}
              <span className="text-white/70">shown here</span>
            </p>
          </div>

          {/*
            The honest line. It is not a disclaimer tucked under the fold: it
            sits with the two figures it explains, because the gap between them
            is the first thing anybody who can count will notice.
          */}
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/60">
            Pledges appear on this page only where the pledger gave permission.
            Many members give privately.
          </p>
        </div>
      </header>

      <main className="px-4 py-10 pb-16 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <PledgersList initial={page.items} initialCursor={page.nextCursor} />

          <div className="mt-14 border-t border-neutral-200 pt-10 text-center">
            <p className="text-base text-neutral-700">
              A pledge is a promise to give. The treasurer&apos;s receipt is the
              only receipt.
            </p>
            <Link
              href="/pledge"
              className="btn-primary mt-5 inline-flex h-12 items-center justify-center bg-campfire px-8 text-base font-semibold text-white focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              Make a pledge
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
