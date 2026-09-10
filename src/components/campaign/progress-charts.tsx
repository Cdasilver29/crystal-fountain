"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatKES, formatKESCompact, formatMonthShort } from "@/lib/format";

/**
 * The two charts on the progress page.
 *
 * The only place recharts is imported. It is a client component and nothing on
 * the home page reaches it, which is what keeps roughly 100kB of charting off
 * the page most people arrive on. The home tracker's sparkline is inline SVG
 * for exactly that reason.
 *
 * Amounts arrive as minor unit strings and are converted once, here, into plain
 * numbers for the chart geometry. That is the one place in this codebase where
 * a money value legitimately becomes a JavaScript number: a pixel position
 * cannot be a bigint, and by this point the figure has stopped being money and
 * become a coordinate. Every number a reader actually sees is formatted from
 * the original string.
 */

const NAVY = "#052252";
const CAMPFIRE = "#e36520";
const DENIM = "#2f557f";

export type SeriesPoint = {
  date: string;
  pledgedMinor: string;
  receivedMinor: string;
};

export type MonthPoint = {
  month: string;
  newPledgedMinor: string;
};

type ChartPoint = {
  date: string;
  label: string;
  pledged: number;
  received: number;
  pledgedMinor: string;
  receivedMinor: string;
};

/** Minor units to whole shillings as a number, for chart geometry only. */
function toShillings(minor: string): number {
  return Number(BigInt(minor) / 100n);
}

/**
 * An axis tick: the magnitude, with no currency on it.
 *
 * formatKESCompact returns "KES 550.0M", which wrapped onto two lines in the
 * axis gutter and made the chart look broken. The axis is entirely shillings
 * and the section says so, so the prefix is noise repeated at every tick. The
 * tooltip and the cards still carry it, because there it is the only thing
 * saying what the number is.
 */
function axisTick(shillings: number): string {
  const value = Math.round(shillings);
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

function CumulativeTooltip({
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
        {new Date(`${point.date}T12:00:00Z`).toLocaleDateString("en-KE", {
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        })}
      </p>
      <p className="tabular mt-1 text-sm font-semibold text-campfire">
        {formatKES(point.pledgedMinor)} pledged
      </p>
      <p className="tabular text-sm font-semibold text-denim">
        {formatKES(point.receivedMinor)} received
      </p>
    </div>
  );
}

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

/**
 * Cumulative pledged and received, with the target as a ceiling.
 *
 * The reference line is what gives the two areas their meaning. Without it the
 * chart reads as steady growth; with it, the distance still to travel is the
 * first thing anybody sees, which is the honest thing for this page to say.
 */
export function CumulativeChart({
  points,
  targetMinor,
}: {
  points: SeriesPoint[];
  targetMinor: string;
}) {
  const data: ChartPoint[] = points.map((point) => ({
    date: point.date,
    label: formatMonthShort(point.date),
    pledged: toShillings(point.pledgedMinor),
    received: toShillings(point.receivedMinor),
    pledgedMinor: point.pledgedMinor,
    receivedMinor: point.receivedMinor,
  }));

  const target = toShillings(targetMinor);

  /*
   * The axis is scaled to the target, not to the data. A campaign at 0.18% of
   * its goal drawn against its own maximum looks like a completed campaign, and
   * this page is read by people deciding whether to give.
   */
  return (
    <div className="h-[300px] w-full sm:h-[400px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="pledgedFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CAMPFIRE} stopOpacity={0.35} />
              <stop offset="100%" stopColor={CAMPFIRE} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="receivedFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={DENIM} stopOpacity={0.3} />
              <stop offset="100%" stopColor={DENIM} stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="#e5e5e5" strokeDasharray="3 3" vertical={false} />

          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: "#737373" }}
            tickLine={false}
            axisLine={{ stroke: "#e5e5e5" }}
            minTickGap={40}
          />
          <YAxis
            tick={{ fontSize: 12, fill: "#737373" }}
            tickLine={false}
            axisLine={false}
            width={52}
            domain={[0, target]}
            tickFormatter={axisTick}
          />

          <Tooltip content={<CumulativeTooltip />} />

          <ReferenceLine
            y={target}
            stroke={NAVY}
            strokeDasharray="6 4"
            label={{
              value: `${formatKESCompact(targetMinor)} target`,
              position: "insideTopRight",
              fill: NAVY,
              fontSize: 12,
            }}
          />

          <Area
            type="monotone"
            dataKey="pledged"
            stroke={CAMPFIRE}
            strokeWidth={2}
            fill="url(#pledgedFill)"
            // The dots would be 432 of them on a year of history.
            dot={false}
            activeDot={{ r: 4 }}
            name="Pledged"
          />
          <Area
            type="monotone"
            dataKey="received"
            stroke={DENIM}
            strokeWidth={2}
            fill="url(#receivedFill)"
            dot={false}
            activeDot={{ r: 4 }}
            name="Received"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** New pledging per calendar month. */
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
          <CartesianGrid stroke="#e5e5e5" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: "#737373" }}
            tickLine={false}
            axisLine={{ stroke: "#e5e5e5" }}
            minTickGap={16}
          />
          <YAxis
            tick={{ fontSize: 12, fill: "#737373" }}
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
