"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  AXIS_TEXT,
  CAMPFIRE,
  GRID,
  axisTick,
  toShillings,
} from "@/components/charts/chart-theme";
import { formatKES, formatMonthShort } from "@/lib/format";

/**
 * New pledging per calendar month, on the progress page.
 *
 * The cumulative chart used to live here beside it. It moved to
 * components/charts/cumulative-chart.tsx when the admin analytics page needed
 * the same one, and this file kept the chart only the public page draws.
 *
 * Still a client component, and still one of only two places recharts is
 * imported. Nothing on the home page reaches either, which is what keeps
 * roughly 110kB of charting off the page most people arrive on. The home
 * tracker's sparkline is inline SVG for exactly that reason.
 */

export type MonthPoint = {
  month: string;
  newPledgedMinor: string;
};

function MonthlyTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: { label: string; newPledgedMinor: string } }[];
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;

  return (
    <div className="rounded-lg border border-black/5 bg-white px-3 py-2 shadow-md">
      <p className="text-xs font-medium text-neutral-500">{point.label}</p>
      <p className="tabular mt-1 text-sm font-semibold text-campfire">
        {formatKES(point.newPledgedMinor)} pledged
      </p>
    </div>
  );
}

export function MonthlyChart({ points }: { points: MonthPoint[] }) {
  const data = points.map((point) => ({
    label: formatMonthShort(`${point.month}-01`),
    value: toShillings(point.newPledgedMinor),
    newPledgedMinor: point.newPledgedMinor,
  }));

  return (
    <div className="h-[260px] w-full sm:h-[320px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: AXIS_TEXT }}
            tickLine={false}
            axisLine={{ stroke: GRID }}
            minTickGap={16}
          />
          <YAxis
            tick={{ fontSize: 12, fill: AXIS_TEXT }}
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={axisTick}
          />
          <Tooltip
            content={<MonthlyTooltip />}
            cursor={{ fill: "rgba(227, 101, 32, 0.08)" }}
          />
          <Bar dataKey="value" fill={CAMPFIRE} radius={[4, 4, 0, 0]} name="Pledged" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
