import type { Metadata } from "next";
import Link from "next/link";

import {
  CumulativeChart,
  MonthlyChart,
} from "@/components/campaign/progress-charts";
import { db } from "@/db";
import { CAMPAIGN_SLUG, getCampaignTotals } from "@/lib/campaign";
import {
  formatKES,
  formatKESCompact,
  formatNumber,
  formatPercent,
} from "@/lib/format";
import { pageMetadata } from "@/lib/metadata";
import * as metrics from "@/server/services/metrics";
import * as snapshots from "@/server/services/snapshots";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "Campaign progress",
  path: "/progress",
});

/**
 * The public progress page.
 *
 * Everything is read on the server and rendered into the first paint. The two
 * charts are the only client components on the page, and they are the only
 * place recharts is imported anywhere in the project, which is what keeps it
 * off the home page bundle.
 *
 * Every figure comes from the database at request time: the summary from
 * v_campaign_totals, the charts from campaign_daily_stats, the metrics derived
 * from both. Nothing here is stored or configured, per CLAUDE.md.
 */

function Card({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
        {label}
      </p>
      <p
        className={`tabular mt-2 text-2xl font-semibold ${accent ? "text-campfire" : "text-navy"}`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}

/**
 * A metric that has no answer yet.
 *
 * Shown as "Not enough data yet" rather than as a zero, because a run rate of
 * zero means nothing is coming in, which is a real and much worse thing to say
 * about a campaign than that it is too early to tell.
 */
function metricValue(
  value: bigint | number | null,
  format: (v: never) => string,
): string {
  if (value === null) return "Not enough data yet";
  return format(value as never);
}

export default async function ProgressPage() {
  const [totals, series, monthly, key] = await Promise.all([
    getCampaignTotals(),
    snapshots.series(db, { campaignSlug: CAMPAIGN_SLUG }),
    snapshots.monthly(db, { campaignSlug: CAMPAIGN_SLUG }),
    metrics.keyMetrics(db, { campaignSlug: CAMPAIGN_SLUG }),
  ]);

  const hasHistory = series.length >= 2;
  const hasMonths = monthly.some((month) => month.newPledgedMinor > 0n);

  return (
    <div className="flex flex-1 flex-col bg-neutral-50">
      <header className="bg-navy px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto w-full max-w-5xl">
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Campaign progress
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-white/80">
            Where the Crystal Fountain Development Project stands today, and how
            it got here. These figures come straight from the pledge ledger and
            update as pledges are approved and payments recorded.
          </p>
        </div>
      </header>

      <main className="px-4 py-12 pb-20 sm:px-6">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-12">
          <section aria-labelledby="summary-heading">
            <h2
              id="summary-heading"
              className="mb-4 text-xl font-semibold tracking-tight text-navy"
            >
              Where we are
            </h2>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Card label="Target" value={formatKES(totals.targetMinor)} />
              <Card
                label="Pledged"
                value={formatKES(totals.pledgedMinor)}
                accent
                hint={`${formatPercent(totals.percentPledged)} of the target`}
              />
              <Card
                label="Received"
                value={formatKES(totals.receivedMinor)}
                hint={`${formatPercent(totals.percentReceived)} of the target`}
              />
              <Card
                label="Remaining"
                value={formatKES(totals.remainingMinor)}
                hint="Still to be pledged"
              />
              <Card
                label="Progress"
                value={formatPercent(totals.percentPledged)}
                hint="Pledged against the target"
              />
              <Card
                label="Pledges"
                value={formatNumber(totals.pledgeCount)}
                hint={`from ${formatNumber(totals.pledgerCount)} ${
                  totals.pledgerCount === 1 ? "person" : "people"
                }`}
              />
            </div>
          </section>

          <section aria-labelledby="cumulative-heading">
            <h2
              id="cumulative-heading"
              className="text-xl font-semibold tracking-tight text-navy"
            >
              Pledges over time
            </h2>
            <p className="mt-1 mb-4 max-w-2xl text-sm text-neutral-600">
              Everything pledged and everything received, day by day, against
              the target. The scale runs to the full target, so the distance
              still to travel is visible rather than hidden by a fitted axis.
            </p>

            <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm sm:p-6">
              {hasHistory ? (
                <CumulativeChart
                  targetMinor={totals.targetMinor}
                  points={series.map((day) => ({
                    date: day.statDate,
                    pledgedMinor: day.pledgedMinor.toString(),
                    receivedMinor: day.receivedMinor.toString(),
                  }))}
                />
              ) : (
                <p className="py-12 text-center text-sm text-neutral-600">
                  The daily history starts building from the campaign&apos;s
                  first recorded day. There is not enough of it to draw yet.
                </p>
              )}
            </div>
          </section>

          <section aria-labelledby="monthly-heading">
            <h2
              id="monthly-heading"
              className="text-xl font-semibold tracking-tight text-navy"
            >
              Pledged each month
            </h2>
            <p className="mt-1 mb-4 max-w-2xl text-sm text-neutral-600">
              New pledging per calendar month, which is what shows momentum
              rather than accumulation.
            </p>

            <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm sm:p-6">
              {hasMonths ? (
                <MonthlyChart
                  points={monthly.map((month) => ({
                    month: month.month,
                    newPledgedMinor: month.newPledgedMinor.toString(),
                  }))}
                />
              ) : (
                <p className="py-12 text-center text-sm text-neutral-600">
                  No month has recorded a pledge yet.
                </p>
              )}
            </div>
          </section>

          <section aria-labelledby="metrics-heading">
            <h2
              id="metrics-heading"
              className="mb-4 text-xl font-semibold tracking-tight text-navy"
            >
              The shape of the giving
            </h2>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Card
                label="Average pledge"
                value={metricValue(key.averagePledgeMinor, (v: bigint) =>
                  formatKES(v),
                )}
                hint="Across every approved pledge"
              />
              <Card
                label="Median pledge"
                value={metricValue(key.medianPledgeMinor, (v: bigint) =>
                  formatKES(v),
                )}
                hint="The middle pledge, not the mean"
              />
              <Card
                label="Recent pace"
                value={metricValue(key.runRate4WeekMinor, (v: bigint) =>
                  formatKESCompact(v),
                )}
                hint="Average pledged per week, last 4 weeks"
              />
              <Card
                label="Settled pace"
                value={metricValue(key.runRate12WeekMinor, (v: bigint) =>
                  formatKESCompact(v),
                )}
                hint="Average pledged per week, last 12 weeks"
              />
              <Card
                label="At this pace"
                value={
                  key.weeksToTarget === null
                    ? "Not enough data yet"
                    : key.weeksToTarget === 0
                      ? "Target reached"
                      : `${formatNumber(key.weeksToTarget)} weeks`
                }
                hint={
                  key.monthsToTarget && key.monthsToTarget > 0
                    ? `about ${formatNumber(key.monthsToTarget)} months`
                    : undefined
                }
              />
              <Card
                label="Needed each month"
                value={metricValue(key.requiredMonthlyMinor, (v: bigint) =>
                  formatKESCompact(v),
                )}
                accent
                hint={`to reach the target in ${formatNumber(key.monthsRemaining)} months`}
              />
            </div>
          </section>

          <section className="rounded-2xl bg-navy px-6 py-10 text-center sm:px-10">
            <h2 className="text-2xl font-semibold tracking-tight text-white">
              Add your pledge to these figures
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-white/80">
              A pledge is a promise to give, not a payment. You choose when and
              how to fulfil it.
            </p>
            <Link
              href="/pledge"
              className="mt-6 inline-flex h-13 items-center justify-center rounded-xl bg-campfire px-9 text-base font-semibold text-white transition-colors hover:bg-[#ef7433] focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-navy focus-visible:outline-none"
            >
              Make a pledge
            </Link>
          </section>
        </div>
      </main>
    </div>
  );
}
