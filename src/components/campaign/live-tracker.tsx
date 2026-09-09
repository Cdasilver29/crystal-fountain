"use client";

import { useEffect, useRef, useState } from "react";

import type { CampaignTotalsDto } from "@/lib/campaign";
import { formatKES, formatNumber, formatPercent } from "@/lib/format";

/**
 * The live campaign tracker in the hero.
 *
 * A glass panel floating over the hero photograph, because this is the figure a
 * member arriving from WhatsApp is here to see and it should read as one
 * object rather than as a paragraph with a line under it.
 *
 * The server renders this with real totals already in props, so the first paint
 * carries the true figure and the page is correct with JavaScript disabled.
 * After hydration it polls /api/campaign/summary every 30 seconds, but only
 * while the tab is visible, so a phone left open in a pocket is not sending a
 * request every half minute all afternoon.
 *
 * Money stays a bigint end to end. The count up interpolates in integer space
 * between two bigints, so no amount is ever held as a JavaScript number, and
 * the value it settles on is exactly the value the server sent.
 *
 * Only the card is here. The call to action and the scripture sit outside it in
 * the hero, so the card is purely the numbers.
 */

const POLL_INTERVAL_MS = 30_000;

/** The opening count up, once, on first mount. */
const COUNT_UP_MS = 1_500;

/** A later poll moving the total. Short, because it is an update, not an entrance. */
const DELTA_MS = 600;

export function LiveTracker({ initial }: { initial: CampaignTotalsDto }) {
  const [totals, setTotals] = useState(initial);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/campaign/summary", {
          cache: "no-store",
        });
        if (!response.ok) return;
        const next = (await response.json()) as CampaignTotalsDto;
        if (!cancelled) setTotals(next);
      } catch {
        // Offline or a flaky connection. Keep showing the last known figure
        // rather than blanking the number the congregation is watching.
      }
    }

    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    // Catch up immediately when the tab comes back rather than waiting.
    document.addEventListener("visibilitychange", refresh);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  // Always show a sliver, so the bar never reads as broken at the very start.
  const fill = Math.max(Math.min(totals.percentPledged, 100), 0.4);

  return (
    /*
     * Full width of the hero's content column on a phone, which lands at
     * roughly 90% of a 360px screen once the hero's own side padding is taken
     * off, and eases back to 90% of a wider column before the 640px ceiling
     * takes over. Padding tightens only on the narrowest screens, where 20px a
     * side starts to eat into the headline.
     */
    <div className="tracker-card mx-auto w-full max-w-[640px] p-5 text-center max-[400px]:p-4 sm:w-[90%] md:p-8">
      <p className="tabular font-semibold tracking-tight text-white [font-size:clamp(2rem,8vw,4rem)] [line-height:1.05]">
        <CountUp value={BigInt(totals.pledgedMinor)} />
      </p>

      <p className="mt-2 text-sm text-white/70 sm:text-base">
        pledged toward {formatKES(totals.targetMinor)}
      </p>

      <div
        className="mt-6 h-3 w-full overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-valuenow={totals.percentPledged}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Pledged against the campaign target"
      >
        <div
          className="tracker-fill h-full rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${fill}%` }}
        />
      </div>

      <dl className="mt-6 grid grid-cols-3 gap-2">
        <Stat
          label="of goal"
          value={formatPercent(totals.percentPledged)}
        />
        <Stat
          label={totals.pledgeCount === 1 ? "pledge" : "pledges"}
          value={formatNumber(totals.pledgeCount)}
        />
        <Stat label="received" value={formatKES(totals.receivedMinor)} />
      </dl>
    </div>
  );
}

/**
 * One of the three figures under the bar.
 *
 * The value is set larger than its label so the eye reads the number first and
 * the word only if it needs to. Every value is tabular, so three columns of
 * digits stay in their columns while the poll moves them.
 */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <dd className="tabular text-sm font-semibold text-white sm:text-base">
        {value}
      </dd>
      <dt className="text-xs text-white/60">{label}</dt>
    </div>
  );
}

/**
 * Counts up to the pledged figure.
 *
 * Two speeds. On first mount it runs from zero over a second and a half, which
 * is the launch flourish. Every later change is a poll moving the total, and
 * those animate only the distance actually travelled, over a much shorter time:
 * re-running the full count up every thirty seconds would make the number
 * unreadable, and snapping would lose the one moment the page has to show that
 * something just arrived.
 *
 * Interpolation is integer arithmetic on bigints: at progress k out of 1000 the
 * displayed value is from + ((to - from) * k) / 1000. Nothing here converts a
 * money amount to a number, and the final frame is the exact value the server
 * sent.
 */
function CountUp({ value }: { value: bigint }) {
  const [shown, setShown] = useState(value);

  /*
   * The value the animation has settled on. Null until the first run finishes,
   * so this records completion and not merely that a run was started. React
   * invokes an effect twice on mount in development, cancelling the first run
   * partway through: marking the flag up front would leave the second run
   * believing the animation had already happened and the number would never
   * move.
   */
  const settledOn = useRef<bigint | null>(null);

  // Read in the effect without re-triggering it. The effect depends on the
  // target, not on whatever frame the previous animation happened to reach.
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(() => {
    const first = settledOn.current === null;

    if (!first && settledOn.current === value) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const from = first ? 0n : shownRef.current;

    if (reduceMotion || value === from) {
      settledOn.current = value;
      setShown(value);
      return;
    }

    const duration = first ? COUNT_UP_MS : DELTA_MS;
    const distance = value - from;
    const start = performance.now();
    let frame = 0;

    const step = (now: number) => {
      const elapsed = now - start;
      if (elapsed >= duration) {
        settledOn.current = value;
        setShown(value);
        return;
      }
      // Ease out, resolved to an integer numerator over 1000.
      const linear = elapsed / duration;
      const eased = 1 - (1 - linear) * (1 - linear);
      const k = BigInt(Math.round(eased * 1000));
      setShown(from + (distance * k) / 1000n);
      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);

    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <>{formatKES(shown)}</>;
}
