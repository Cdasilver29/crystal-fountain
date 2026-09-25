import type { Metadata } from "next";
import Link from "next/link";

import { MonthlyChart } from "@/components/campaign/progress-charts";
import { StatCount } from "@/components/campaign/stat-count";
import { CumulativeChart } from "@/components/charts/cumulative-chart";
import { db } from "@/db";
import { CAMPAIGN_SLUG, getCampaignTotals } from "@/lib/campaign";
import { formatNumber, formatPercent } from "@/lib/format";
import { pageMetadata } from "@/lib/metadata";
import * as metrics from "@/server/services/metrics";
import * as snapshots from "@/server/services/snapshots";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "Campaign progress",
  description:
    "Live progress toward the KES 550M target for the Crystal Fountain Development Project: what has been pledged, what has been received, and how many have given.",
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
  value: React.ReactNode;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      data-tilt=""
      className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm"
    >
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
  value: bigint | null,
  format: "kes" | "kesCompact",
): React.ReactNode {
  if (value === null) return "Not enough data yet";
  return <StatCount value={value.toString()} format={format} />;
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
  const outstanding =
    BigInt(totals.pledgedMinor) - BigInt(totals.receivedMinor);
  const stillToCome = outstanding > 0n ? outstanding : 0n;

  return (
    <div className="flex flex-1 flex-col bg-neutral-50">
      <header className="bg-navy page-gutter section-feature">
        <div className="container-marketing">
          <h1 className="font-display text-3xl font-bold text-white sm:text-4xl">
            Campaign progress
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-white/80">
            Where the Crystal Fountain Development Project stands today, and how
            it got here. These figures come straight from the pledge ledger and
            update as pledges are approved and payments recorded.
          </p>
        </div>
      </header>

      <main className="page-gutter section">
        <div className="container-marketing block-stack">
          <section aria-labelledby="summary-heading">
            <h2
              id="summary-heading"
              className="font-display mb-4 text-xl font-semibold text-navy"
            >
              Where we are
            </h2>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Card label="Target" value={<StatCount value={totals.targetMinor.toString()} format="kes" />} />
              <Card
                label="Pledged"
                value={<StatCount value={totals.pledgedMinor.toString()} format="kes" />}
                accent
                hint={`${formatPercent(totals.percentPledged)} of the target`}
              />
              {/*
                The hint says what share of the pledges has arrived, not what
                share of the target. Against the target it is the same money counted a
                second time; against the pledges it answers a question the other
                cards do not.
              */}
              <Card
                label="Received"
                value={<StatCount value={totals.receivedMinor.toString()} format="kes" />}
                hint={`${formatPercent(totals.percentRedeemed)} of what has been pledged`}
              />
              <Card
                label="Remaining"
                value={<StatCount value={totals.remainingMinor.toString()} format="kes" />}
                hint="Still to be pledged"
              />
              <Card
                label="Still to come in"
                value={
<StatCount value={stillToCome.toString()} format="kes" />
                }
                hint="Pledged but not yet received"
              />
              <Card
                label="Pledges"
                value={
                  <StatCount
                    value={totals.pledgeCount.toString()}
                    format="number"
                  />
                }
                hint={`from ${formatNumber(totals.pledgerCount)} ${
                  totals.pledgerCount === 1 ? "person" : "people"
                }`}
              />
            </div>
          </section>

          <section aria-labelledby="cumulative-heading">
            <h2
              id="cumulative-heading"
              className="font-display text-xl font-semibold text-navy"
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
              className="font-display text-xl font-semibold text-navy"
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
              className="font-display mb-4 text-xl font-semibold text-navy"
            >
              The shape of the giving
            </h2>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Card
                label="Average pledge"
                value={metricValue(key.averagePledgeMinor, "kes")}
                hint="Across every approved pledge"
              />
              <Card
                label="Median pledge"
                value={metricValue(key.medianPledgeMinor, "kes")}
                hint="The middle pledge, not the mean"
              />
              <Card
                label="Recent pace"
                value={metricValue(key.runRate4WeekMinor, "kesCompact")}
                hint="Average pledged per week, last 4 weeks"
              />
              <Card
                label="Settled pace"
                value={metricValue(key.runRate12WeekMinor, "kesCompact")}
                hint="Average pledged per week, last 12 weeks"
              />
              <Card
                label="At this pace"
                value={
                  key.weeksToTarget === null
                    ? "Not enough data yet"
                    : key.weeksToTarget === 0
                      ? "Target reached"
                      : (
                          <StatCount
                            value={key.weeksToTarget.toString()}
                            format="number"
                            suffix=" weeks"
                          />
                        )
                }
                hint={
                  key.monthsToTarget && key.monthsToTarget > 0
                    ? `about ${formatNumber(key.monthsToTarget)} months`
                    : undefined
                }
              />
              <Card
                label="Needed each month"
                value={metricValue(key.requiredMonthlyMinor, "kesCompact")}
                accent
                hint={`to reach the target in ${formatNumber(key.monthsRemaining)} months`}
              />
            </div>
          </section>

          <section className="rounded-2xl bg-navy px-6 py-10 text-center sm:px-10">
            <h2 className="font-display text-2xl font-semibold text-white">
              Add your pledge to these figures
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-white/80">
              A pledge is a promise to give, not a payment. You choose when and
              how to fulfil it.
            </p>
            <Link
              href="/pledge"
              className="btn-primary cta-sweep mt-6 [--sweep-delay:2.6s] inline-flex h-13 items-center justify-center bg-campfire px-9 text-base font-semibold text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-navy focus-visible:outline-none"
            >
              Make a pledge
            </Link>
          </section>
        </div>
      </main>
    </div>
  );
}
