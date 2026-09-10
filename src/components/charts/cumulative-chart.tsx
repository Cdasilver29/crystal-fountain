"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
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
  NAVY,
  axisTick,
  toShillings,
  tooltipDate,
} from "@/components/charts/chart-theme";
import { formatKES, formatKESCompact, formatMonthShort } from "@/lib/format";

/**
 * Cumulative pledged and received, with the target as a ceiling.
 *
 * Shared by the public progress page and the admin analytics page. It used to
 * live beside the monthly chart in components/campaign and was lifted here
 * when the second page needed it, so there is one chart and not two that drift.
 *
 * The reference line is what gives the two areas their meaning. Without it the
 * chart reads as steady growth; with it, the distance still to travel is the
 * first thing anybody sees, which is the honest thing for these pages to say.
 *
 * The projection is an Area with its fill switched off rather than a Line. A
 * Line would mean a ComposedChart, and swapping AreaChart for ComposedChart
 * pulled the Line, Bar and Scatter renderers into the public progress page and
 * put twelve kilobytes on it for a dashed line that page never draws. An
 * unfilled Area is the same stroke at no cost.
 *
 * Sharing this component is not free even so. /progress went from 233kB to
 * 242kB when the chart moved out, because the page now has two client modules
 * rather than one and Turbopack gives each its own chunk group with some
 * recharts runtime in both. Re-exporting this through progress-charts so the
 * page imports from a single module was tried and changes nothing: the client
 * reference resolves to the module that defines the component either way.
 *
 * The nine kilobytes are worth one chart instead of two that drift apart, and
 * the page that matters is unaffected. The home page never reaches either of
 * these modules and is still 146kB, which is what verify-part-k enforces.
 */

const NO_POINTS: ProjectedPoint[] = [];

export type SeriesPoint = {
  date: string;
  pledgedMinor: string;
  receivedMinor: string;
};

export type ProjectedPoint = {
  date: string;
  pledgedMinor: string;
};

type ChartPoint = {
  date: string;
  label: string;
  pledged?: number;
  received?: number;
  projected?: number;
  pledgedMinor?: string;
  receivedMinor?: string;
  projectedMinor?: string;
};

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
        {tooltipDate(point.date)}
      </p>

      {point.pledgedMinor !== undefined && (
        <p className="tabular mt-1 text-sm font-semibold text-campfire">
          {formatKES(point.pledgedMinor)} pledged
        </p>
      )}
      {point.receivedMinor !== undefined && (
        <p className="tabular text-sm font-semibold text-denim">
          {formatKES(point.receivedMinor)} received
        </p>
      )}
      {/* Only ever shown on a future date, and labelled as a projection so it
          is never mistaken for something that happened. */}
      {point.projectedMinor !== undefined && point.pledgedMinor === undefined && (
        <p className="tabular mt-1 text-sm font-semibold text-neutral-500">
          {formatKES(point.projectedMinor)} projected
        </p>
      )}
    </div>
  );
}

export function CumulativeChart({
  points,
  targetMinor,
  projection = NO_POINTS,
}: {
  points: SeriesPoint[];
  targetMinor: string;
  /**
   * An optional dashed continuation of the pledged line. Its first point
   * should be the last actual one, which is what joins the two.
   */
  projection?: ProjectedPoint[];
}) {
  const actual: ChartPoint[] = points.map((point) => ({
    date: point.date,
    label: formatMonthShort(point.date),
    pledged: toShillings(point.pledgedMinor),
    received: toShillings(point.receivedMinor),
    pledgedMinor: point.pledgedMinor,
    receivedMinor: point.receivedMinor,
  }));

  /*
   * The joining point is merged into the last actual row rather than appended
   * as a row of its own. Appending it would put two categories on the same
   * date, which recharts draws as a visible step backwards in the area.
   */
  const [joins, ahead] =
    projection.length > 0
      ? [projection[0], projection.slice(1)]
      : [undefined, NO_POINTS];

  if (joins && actual.length > 0) {
    const last = actual[actual.length - 1];
    last.projected = toShillings(joins.pledgedMinor);
    last.projectedMinor = joins.pledgedMinor;
  }

  const data: ChartPoint[] = [
    ...actual,
    ...ahead.map((point) => ({
      date: point.date,
      label: formatMonthShort(point.date),
      projected: toShillings(point.pledgedMinor),
      projectedMinor: point.pledgedMinor,
    })),
  ];

  const target = toShillings(targetMinor);

  /*
   * The axis is scaled to the target, not to the data. A campaign at 0.18% of
   * its goal drawn against its own maximum looks like a completed campaign, and
   * the public one of these pages is read by people deciding whether to give.
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

          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />

          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: AXIS_TEXT }}
            tickLine={false}
            axisLine={{ stroke: GRID }}
            minTickGap={40}
          />
          <YAxis
            tick={{ fontSize: 12, fill: AXIS_TEXT }}
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

          {projection.length > 0 && (
            <Area
              type="linear"
              dataKey="projected"
              stroke={NAVY}
              strokeWidth={2}
              strokeDasharray="6 4"
              fill="none"
              fillOpacity={0}
              dot={false}
              activeDot={{ r: 4 }}
              // Every actual row before the join has no projected value at
              // all, and joining across them would draw the dashed line back
              // to the start of the campaign.
              connectNulls={false}
              name="Projected"
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
