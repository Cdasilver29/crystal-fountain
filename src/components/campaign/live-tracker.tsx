"use client";

import { useEffect, useRef, useState } from "react";

import type { CampaignTotalsDto } from "@/lib/campaign";
import { formatKes, formatKesAmount } from "@/lib/format";

/**
 * The live campaign tracker in the hero.
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
const COUNT_UP_MS = 1_500;

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
  // Always show a sliver, so the bar never reads as broken at the very start.
  const fill = Math.max(Math.min(totals.percentPledged, 100), 0.4);

  return (
    <div className="w-full">
      <p className="tabular font-semibold tracking-tight text-white [font-size:clamp(2.5rem,9vw,5rem)] [line-height:1.05]">
        <CountUp value={pledged} />
      </p>

      <p className="mt-2 text-sm text-white/70 sm:text-base">
        pledged toward {formatKes(totals.targetMinor)}
      </p>

      <div
        className="mt-6 h-2 w-full overflow-hidden rounded-full bg-white/20"
        role="progressbar"
        aria-valuenow={totals.percentPledged}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Pledged against the campaign target"
      >
        <div
          className="progress-fill h-full rounded-full bg-campfire transition-[width] duration-700 ease-out"
          style={{ width: `${fill}%` }}
        />
      </div>

      <dl className="mt-3 flex items-baseline justify-between gap-4 text-sm text-white/70">
        <div className="flex gap-1.5">
          <dt className="sr-only">Progress</dt>
          <dd className="tabular font-medium text-white">
            {totals.percentPledged.toFixed(2)}%
          </dd>
          <dd>of goal</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="sr-only">Pledges</dt>
          <dd className="tabular font-medium text-white">
            {totals.pledgeCount.toLocaleString("en-KE")}
          </dd>
          <dd>{totals.pledgeCount === 1 ? "pledge" : "pledges"}</dd>
        </div>
      </dl>

      {received > 0n && (
        <p className="mt-2 text-xs text-white/60 sm:text-sm">
          <span className="tabular">{formatKes(received)}</span> received so far
        </p>
      )}
    </div>
  );
}

/**
 * Counts up from zero to the pledged figure, once, when the hero first mounts.
 *
 * Interpolation is integer arithmetic on bigints: at progress k out of 1000,
 * the displayed value is (to * k) / 1000. Nothing here converts a money amount
 * to a number, and the final frame is the exact value the server sent.
 *
 * A poll that moves the total later lands on the new figure directly. The
 * count up is a launch flourish, not a transition, and re-running it every
 * thirty seconds would make the number unreadable.
 */
function CountUp({ value }: { value: bigint }) {
  const [shown, setShown] = useState(value);
  // The value the count up has settled on. Null until it finishes, so this
  // records completion and not merely that a run was started. React invokes an
  // effect twice on mount in development, cancelling the first run partway
  // through: marking the flag up front would leave the second run believing
  // the animation had already happened and the number would never move.
  const settledOn = useRef<bigint | null>(null);

  useEffect(() => {
    if (settledOn.current !== null) {
      // A later update from the poll. Land on it.
      settledOn.current = value;
      setShown(value);
      return;
    }

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduceMotion || value === 0n) {
      settledOn.current = value;
      setShown(value);
      return;
    }

    const target = value;
    const start = performance.now();
    let frame = 0;

    const step = (now: number) => {
      const elapsed = now - start;
      if (elapsed >= COUNT_UP_MS) {
        settledOn.current = target;
        setShown(target);
        return;
      }
      // Ease out, resolved to an integer numerator over 1000.
      const linear = elapsed / COUNT_UP_MS;
      const eased = 1 - (1 - linear) * (1 - linear);
      const k = BigInt(Math.round(eased * 1000));
      setShown((target * k) / 1000n);
      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);

    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <>KES {formatKesAmount(shown)}</>;
}
