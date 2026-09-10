import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AdminNav } from "@/components/admin/admin-nav";
import { WeeklyTrendsChart } from "@/components/admin/analytics-charts";
import { AGEING_COLOURS } from "@/components/charts/chart-theme";
import { CumulativeChart } from "@/components/charts/cumulative-chart";
import { db } from "@/db";
import { getCurrentAdmin } from "@/lib/admin-context";
import { CAMPAIGN_SLUG } from "@/lib/campaign";
import {
  formatKES,
  formatKESCompact,
  formatNumber,
  formatPercent,
} from "@/lib/format";
import { getTotals } from "@/server/services/campaign";
import * as analytics from "@/server/services/analytics";
import * as metrics from "@/server/services/metrics";
import * as snapshots from "@/server/services/snapshots";

export const metadata: Metadata = {
  title: "Analytics",
  robots: { index: false, follow: false },
};

// Reads a cookie, so it can never be prerendered.
export const dynamic = "force-dynamic";

/**
 * The admin analytics page.
 *
 * Every role may read this, viewer included. Nothing on it can be acted on and
 * nothing on it names a person, so there is no write to gate and no contact
 * detail to withhold. It is behind a session because a collections report is
 * an operational document, not because a row in it is sensitive.
 *
 * Read only from end to end, so there is no audit row. CLAUDE.md requires one
 * for every admin write, and this writes nothing.
 *
 * The totals come from getTotals rather than the cached getCampaignTotals the
 * public pages use. A treasurer who has just recorded a payment and come here
 * to check the effect should not be looking at a figure up to thirty seconds
 * old, and this page has one reader at a time rather than a WhatsApp surge, so
 * the cache is not buying anything.
 *
 * The second chart on /progress, new pledging per calendar month, is
 * deliberately not repeated here. Section 5 is the same information at a
 * useful resolution for an administrator, and two charts of one series in
 * different buckets on one page is noise.
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

function Section({
  id,
  title,
  blurb,
  children,
}: {
  id: string;
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <h2
        id={id}
        className="text-xl font-semibold tracking-tight text-navy"
      >
        {title}
      </h2>
      <p className="mt-1 mb-4 max-w-2xl text-sm text-neutral-600">{blurb}</p>
      {children}
    </section>
  );
}

/**
 * A metric with no answer yet.
 *
 * "No data yet" rather than a zero, for the reason metrics.ts gives: zero is a
 * real answer meaning nothing is coming in, and a page that cannot tell that
 * apart from "too early to say" will eventually tell the treasurer the wrong
 * thing.
 */
function metricValue(
  value: bigint | number | null,
  format: (v: never) => string,
): string {
  if (value === null) return "No data yet";
  return format(value as never);
}

export default async function AdminAnalyticsPage() {
  const admin = await getCurrentAdmin();

  if (!admin) redirect("/admin/login?next=/admin/analytics");

  const [totals, key, series, fulfilment, ageing, channels, weekly] =
    await Promise.all([
      getTotals(db, { campaignSlug: CAMPAIGN_SLUG }),
      metrics.keyMetrics(db, { campaignSlug: CAMPAIGN_SLUG }),
      snapshots.series(db, { campaignSlug: CAMPAIGN_SLUG }),
      analytics.fulfilment(db, { campaignSlug: CAMPAIGN_SLUG }),
      analytics.ageing(db, { campaignSlug: CAMPAIGN_SLUG }),
      analytics.channelMix(db, { campaignSlug: CAMPAIGN_SLUG }),
      analytics.weekly(db, { campaignSlug: CAMPAIGN_SLUG }),
    ]);

  const hasHistory = series.length >= 2;
  const last = series[series.length - 1];

  /*
   * The projection is built from the last recorded day, not from the live
   * total. It has to start where the solid line ends or the dashed line starts
   * with a jump that reads as a day of enormous pledging.
   */
  const projected =
    hasHistory && last
      ? analytics.projection({
          from: { date: last.statDate, pledgedMinor: last.pledgedMinor },
          weeklyRateMinor: key.runRate12WeekMinor,
          targetMinor: totals.targetMinor,
        })
      : [];

  const ageingMax = ageing.buckets.reduce(
    (most, bucket) =>
      bucket.outstandingMinor > most ? bucket.outstandingMinor : most,
    0n,
  );

  const channelMax = channels.reduce(
    (most, row) => (row.totalMinor > most ? row.totalMinor : most),
    0n,
  );

  /** A bar width as a percentage of the largest row. Layout, not money. */
  const share = (value: bigint, largest: bigint): number =>
    largest === 0n ? 0 : Number((value * 1000n) / largest) / 10;

  return (
    <div className="flex flex-1 flex-col bg-neutral-50">
      <header className="bg-navy px-4 py-8 sm:px-6">
        <div className="mx-auto w-full max-w-5xl">
          <AdminNav name={admin.name} role={admin.role} />

          <p className="mt-6 text-sm text-white/70">
            Crystal Fountain Development Project
          </p>

          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">
            Analytics
          </h1>

          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/70">
            The campaign read closely. Everything here is counted from the
            pledge ledger at the moment the page loads, so it agrees with the
            books rather than with a report written earlier.
          </p>
        </div>
      </header>

      <main className="px-4 py-8 pb-16 sm:px-6">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-12">
          {/* 1. Summary */}
          <Section
            id="summary-heading"
            title="Where we are"
            blurb="The public figures, with the three an administrator also needs: how much
            of what was approved has actually arrived, and the size of a typical pledge."
          >
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
              <Card
                label="Fulfilment rate"
                value={metricValue(fulfilment.ratePercent, (v: number) =>
                  formatPercent(v),
                )}
                hint={
                  fulfilment.ratePercent === null
                    ? "No approved pledges to measure against yet"
                    : `${formatKES(fulfilment.allocatedMinor)} allocated against ${formatKES(fulfilment.promisedMinor)} promised`
                }
              />
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
            </div>
          </Section>

          {/* 2. Cumulative */}
          <Section
            id="cumulative-heading"
            title="Pledges over time"
            blurb="Everything pledged and everything received, day by day, against the
            target. The dashed line continues the last twelve weeks of pledging forward at
            the same pace, and is drawn only when there is a pace to continue."
          >
            <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm sm:p-6">
              {hasHistory ? (
                <CumulativeChart
                  targetMinor={totals.targetMinor.toString()}
                  points={series.map((day) => ({
                    date: day.statDate,
                    pledgedMinor: day.pledgedMinor.toString(),
                    receivedMinor: day.receivedMinor.toString(),
                  }))}
                  projection={projected.map((point) => ({
                    date: point.date,
                    pledgedMinor: point.pledgedMinor.toString(),
                  }))}
                />
              ) : (
                <p className="py-12 text-center text-sm text-neutral-600">
                  The daily history starts building from the campaign&apos;s
                  first recorded day. There is not enough of it to draw yet.
                </p>
              )}
            </div>
          </Section>

          {/* 3. Ageing */}
          <Section
            id="ageing-heading"
            title="Outstanding by age"
            blurb="Pledges with money still owed, counted from the day the pledge was made.
            Pending pledges are included: a promise nobody has approved yet is still ageing,
            and the reason it is pending may be that nobody has looked at it."
          >
            {ageing.totalOutstandingMinor === 0n ? (
              <div className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
                <p className="text-sm text-neutral-600">
                  Nothing is outstanding. Every live pledge has been paid in
                  full, or there are no live pledges yet.
                </p>
              </div>
            ) : (
              <>
                {/* The whole outstanding balance as one bar, split by age. */}
                <div
                  className="mb-4 flex h-4 w-full overflow-hidden rounded-full bg-neutral-200"
                  role="img"
                  aria-label={`${formatKES(ageing.totalOutstandingMinor)} outstanding, split by age`}
                >
                  {ageing.buckets.map((bucket, index) => {
                    const width = share(
                      bucket.outstandingMinor,
                      ageing.totalOutstandingMinor,
                    );
                    if (width === 0) return null;
                    return (
                      <div
                        key={bucket.key}
                        style={{
                          width: `${width}%`,
                          backgroundColor: AGEING_COLOURS[index],
                        }}
                      />
                    );
                  })}
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {ageing.buckets.map((bucket, index) => (
                    <div
                      key={bucket.key}
                      className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: AGEING_COLOURS[index] }}
                        />
                        <p className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
                          {bucket.label}
                        </p>
                      </div>

                      <p className="tabular mt-2 text-2xl font-semibold text-navy">
                        {formatKES(bucket.outstandingMinor)}
                      </p>
                      <p className="mt-1 text-xs text-neutral-500">
                        {formatNumber(bucket.pledgeCount)}{" "}
                        {bucket.pledgeCount === 1 ? "pledge" : "pledges"}
                      </p>

                      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${share(bucket.outstandingMinor, ageingMax)}%`,
                            backgroundColor: AGEING_COLOURS[index],
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <p className="mt-4 text-sm text-neutral-600">
                  {formatKES(ageing.totalOutstandingMinor)} outstanding across{" "}
                  {formatNumber(ageing.totalPledges)}{" "}
                  {ageing.totalPledges === 1 ? "pledge" : "pledges"}.
                </p>
              </>
            )}
          </Section>

          {/* 4. Channel mix */}
          <Section
            id="channels-heading"
            title="Where pledges come from"
            blurb="The channel each pledge was recorded through. Most will be the web form
            for now, and that is what it should look like until the event desk starts
            entering cards."
          >
            <div className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
              <ul className="divide-y divide-neutral-100">
                {channels.map((row) => (
                  <li
                    key={row.channel}
                    className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:gap-6"
                  >
                    <div className="sm:w-52 sm:shrink-0">
                      <p className="text-sm font-medium text-navy">
                        {row.label}
                      </p>
                      <p className="text-xs text-neutral-500">
                        {formatNumber(row.pledgeCount)}{" "}
                        {row.pledgeCount === 1 ? "pledge" : "pledges"}
                      </p>
                    </div>

                    <div className="flex flex-1 items-center gap-4">
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
                        <div
                          className="h-full rounded-full bg-campfire"
                          style={{
                            width: `${share(row.totalMinor, channelMax)}%`,
                          }}
                        />
                      </div>
                      <p className="tabular w-32 shrink-0 text-right text-sm font-semibold text-navy">
                        {formatKES(row.totalMinor)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </Section>

          {/* 5. Weekly trends */}
          <Section
            id="weekly-heading"
            title="The last twelve weeks"
            blurb="New pledges and new pledging per ISO week. Counts on the left axis,
            shillings on the right, because a quiet week with one large pledge and a busy
            week of small ones look the same on either axis alone."
          >
            <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm sm:p-6">
              <WeeklyTrendsChart
                points={weekly.map((week) => ({
                  isoWeek: week.isoWeek,
                  weekStart: week.weekStart,
                  newPledges: week.newPledges,
                  newPledgedMinor: week.newPledgedMinor.toString(),
                }))}
              />
            </div>
          </Section>

          {/* 6. Forecasting */}
          <Section
            id="forecast-heading"
            title="What the pace implies"
            blurb="Run rates read off the daily snapshots, and what they mean for the
            target date. These are arithmetic on what has already happened, not a promise
            about what will."
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                    ? "No data yet"
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
              <Card
                label="Months remaining"
                value={formatNumber(key.monthsRemaining)}
                hint={`until ${metrics.TARGET_DATE}`}
              />
              <Card
                label="Projection"
                value={
                  projected.length > 0
                    ? `${formatNumber(projected.length - 1)} days drawn`
                    : "Not drawn"
                }
                hint={
                  projected.length > 0
                    ? "The dashed line on the chart above"
                    : "There is no settled pace to extend forward"
                }
              />
            </div>
          </Section>
        </div>
      </main>
    </div>
  );
}
