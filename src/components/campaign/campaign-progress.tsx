import type { CampaignTotalsDto } from "@/lib/campaign";
import { formatKes } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The live progress figure.
 *
 * The number is the hero, not decoration. Campfire is the only warm colour so
 * the eye lands on the figure that matters. Amounts arrive as minor unit
 * strings and are never converted to a JavaScript number.
 */
export function CampaignProgress({
  totals,
  className,
  compact = false,
}: {
  totals: CampaignTotalsDto;
  className?: string;
  compact?: boolean;
}) {
  // Always show a sliver so the bar never reads as broken at the very start.
  const fill = Math.max(Math.min(totals.percentPledged, 100), 0.6);

  return (
    <div className={cn("w-full", className)}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className={cn(
            "tabular font-semibold tracking-tight text-white",
            compact ? "text-2xl" : "text-4xl sm:text-5xl",
          )}
        >
          {formatKes(totals.pledgedMinor)}
        </span>
        <span className="text-sm text-white/70">
          pledged of {formatKes(totals.targetMinor)}
        </span>
      </div>

      <div
        className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-white/15"
        role="progressbar"
        aria-valuenow={totals.percentPledged}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Pledged against the target"
      >
        <div
          className="h-full rounded-full bg-campfire transition-[width] duration-700 ease-out"
          style={{ width: `${fill}%` }}
        />
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-white/70">
        <div className="flex gap-1.5">
          <dt>Progress</dt>
          <dd className="tabular font-medium text-white">
            {totals.percentPledged.toFixed(2)}%
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Pledges</dt>
          <dd className="tabular font-medium text-white">
            {totals.pledgeCount.toLocaleString("en-KE")}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Received</dt>
          <dd className="tabular font-medium text-white">
            {formatKes(totals.receivedMinor)}
          </dd>
        </div>
      </dl>
    </div>
  );
}
