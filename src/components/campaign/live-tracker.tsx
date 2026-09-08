"use client";

import { useEffect, useRef, useState } from "react";

import type { CampaignTotalsDto } from "@/lib/campaign";
import { formatKes, formatKesAmount } from "@/lib/format";

/**
 * The live campaign tracker.
 *
 * The server renders this with real totals already in props, so the first paint
 * carries the true figure and the page is correct with JavaScript disabled.
 * After hydration it polls /api/campaign/summary every 30 seconds, but only
 * while the tab is visible, so a phone left open in a pocket is not sending a
 * request every half minute all afternoon.
 *
 * Money stays a bigint end to end. The count up animation interpolates in
 * integer space between two bigints, so no amount is ever held as a JavaScript
 * number, and the value it settles on is exactly the value the server sent.
 */

const POLL_INTERVAL_MS = 30_000;
const ANIMATION_MS = 900;

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

  const pledged = BigInt(totals.pledgedMinor);
  const received = BigInt(totals.receivedMinor);
  const fill = Math.max(Math.min(totals.percentPledged, 100), 0.4);

  return (
    <div className="w-full">
      <p className="text-sm font-medium tracking-wide text-white/70">
        Pledged so far
      </p>

      <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="tabular text-4xl font-semibold tracking-tight text-white sm:text-6xl">
          <CountUp value={pledged} />
        </span>
        <span className="text-base text-white/70 sm:text-lg">
          pledged toward {formatKes(totals.targetMinor)}
        </span>
      </p>

      <div
        className="mt-5 h-3 w-full overflow-hidden rounded-full bg-white/15"
        role="progressbar"
        aria-valuenow={totals.percentPledged}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Pledged against the campaign target"
      >
        <div
          className="h-full rounded-full bg-campfire transition-[width] duration-700 ease-out"
          style={{ width: `${fill}%` }}
        />
      </div>

      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm text-white/70">
        <div className="flex gap-2">
          <dt>Progress</dt>
          <dd className="tabular font-semibold text-white">
            {totals.percentPledged.toFixed(2)}%
          </dd>
        </div>
        <div className="flex gap-2">
          <dt>Pledges</dt>
          <dd className="tabular font-semibold text-white">
            {totals.pledgeCount.toLocaleString("en-KE")}
          </dd>
        </div>
        {received > 0n && (
          <div className="flex gap-2">
            <dt>Received</dt>
            <dd className="tabular font-semibold text-white">
              {formatKes(received)} so far
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

/**
 * Counts up to a new value when it increases.
 *
 * Interpolation is integer arithmetic on bigints: at progress k out of 1000,
 * the displayed value is from + (to - from) * k / 1000. Nothing here converts a
 * money amount to a number, and the final frame is the exact target value.
 */
function CountUp({ value }: { value: bigint }) {
  const [shown, setShown] = useState(value);
  const previous = useRef(value);
  const frame = useRef<number | undefined>(undefined);

  useEffect(() => {
    const from = previous.current;
    const to = value;
    previous.current = value;

    if (from === to) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    // Only animate an increase. A correction downward should just land.
    if (reduceMotion || to < from) {
      setShown(to);
      return;
    }

    const start = performance.now();
    const step = (now: number) => {
      const elapsed = now - start;
      if (elapsed >= ANIMATION_MS) {
        setShown(to);
        return;
      }
      // Ease out, resolved to an integer numerator over 1000.
      const linear = elapsed / ANIMATION_MS;
      const eased = 1 - (1 - linear) * (1 - linear);
      const k = BigInt(Math.round(eased * 1000));
      setShown(from + ((to - from) * k) / 1000n);
      frame.current = requestAnimationFrame(step);
    };

    frame.current = requestAnimationFrame(step);

    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    };
  }, [value]);

  return <>KES {formatKesAmount(shown)}</>;
}
