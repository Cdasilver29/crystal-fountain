"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  AXIS_TEXT,
  CAMPFIRE,
  DENIM,
  GRID,
  axisTick,
  toShillings,
} from "@/components/charts/chart-theme";
import { formatKES, formatNumber } from "@/lib/format";

/**
 * The weekly trend chart on /admin/analytics.
 *
 * The only recharts import that is not on the public progress page, and it is
 * reachable from nowhere but this admin route. verify-part-k walks every chunk
 * the home page loads and fails if any of them contains recharts, so this file
 * must stay out of anything the home page can reach.
 *
 * Two bars per week on two axes: how many pledges came in on the left, how
 * much they were worth on the right. Those are different questions and one
 * axis cannot answer both. A quiet week with a single large pledge and a busy
 * week of small ones look identical on a count axis and opposite on an amount
 * axis, and the pair together is the only honest picture.
 */

export type WeekPoint = {
  isoWeek: string;
  weekStart: string;
  newPledges: number;
  newPledgedMinor: string;
};

type ChartPoint = {
  label: string;
  isoWeek: string;
  weekStart: string;
  count: number;
  amount: number;
  newPledgedMinor: string;
};

/** "8 Sep", the Monday the week starts on. The year is in the heading. */
function weekLabel(weekStart: string): string {
  return new Date(`${weekStart}T12:00:00Z`).toLocaleDateString("en-KE", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function WeeklyTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: ChartPoint }[];
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;

  return (
    <div className="rounded-lg border border-black/5 bg-white px-3 py-2 shadow-md">
      <p className="text-xs font-medium text-neutral-500">
        {point.isoWeek}, week of {weekLabel(point.weekStart)}
      </p>
      <p className="tabular mt-1 text-sm font-semibold text-denim">
        {formatNumber(point.count)}{" "}
        {point.count === 1 ? "new pledge" : "new pledges"}
      </p>
      <p className="tabular text-sm font-semibold text-campfire">
        {formatKES(point.newPledgedMinor)} pledged
      </p>
    </div>
  );
}

export function WeeklyTrendsChart({ points }: { points: WeekPoint[] }) {
  const data: ChartPoint[] = points.map((point) => ({
    label: weekLabel(point.weekStart),
    isoWeek: point.isoWeek,
    weekStart: point.weekStart,
    count: point.newPledges,
    amount: toShillings(point.newPledgedMinor),
    newPledgedMinor: point.newPledgedMinor,
  }));

  return (
    <div className="h-[280px] w-full sm:h-[340px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />

          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: AXIS_TEXT }}
            tickLine={false}
            axisLine={{ stroke: GRID }}
            minTickGap={8}
          />

          {/*
            allowDecimals is off on the count axis. Half a pledge is not a
            thing, and with a maximum of one or two pledges a week recharts
            otherwise labels the ticks 0, 0.25, 0.5.
          */}
          <YAxis
            yAxisId="count"
            orientation="left"
            tick={{ fontSize: 12, fill: AXIS_TEXT }}
            tickLine={false}
            axisLine={false}
            width={36}
            allowDecimals={false}
          />
          <YAxis
            yAxisId="amount"
            orientation="right"
            tick={{ fontSize: 12, fill: AXIS_TEXT }}
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={axisTick}
          />

          <Tooltip
            content={<WeeklyTooltip />}
            cursor={{ fill: "rgba(47, 85, 127, 0.08)" }}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, color: AXIS_TEXT }}
            iconType="circle"
          />

          <Bar
            yAxisId="count"
            dataKey="count"
            fill={DENIM}
            radius={[4, 4, 0, 0]}
            name="New pledges"
          />
          <Bar
            yAxisId="amount"
            dataKey="amount"
            fill={CAMPFIRE}
            radius={[4, 4, 0, 0]}
            name="Pledged (KES)"
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
