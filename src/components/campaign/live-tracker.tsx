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

/** How often the "updated" line is recomputed. Five seconds is its own resolution. */
const FRESHNESS_TICK_MS = 5_000;

export function LiveTracker({
  initial,
  sparkline,
}: {
  initial: CampaignTotalsDto;
  /**
   * The momentum line, already rendered on the server.
   *
   * Passed in as an element rather than imported here, because this is a
   * client component and importing it would ship the drawing code to the
   * browser for a picture that never changes after first paint.
   */
  sparkline?: React.ReactNode;
}) {
  const [totals, setTotals] = useState(initial);

  /*
   * When the figures on screen were last known good, as a client clock reading.
   *
   * Null until the browser has it, which is what keeps the first paint
   * identical on the server and on the client: Date.now() cannot be rendered
   * during SSR without the two disagreeing and React throwing the markup away.
   * The line it drives says "just now" either way at that moment, so nothing is
   * lost by waiting a tick for the real reading.
   */
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);

  useEffect(() => {
    setRefreshedAt(Date.now());
  }, []);

  /*
   * The ticking present, so the line ages between polls rather than sitting on
   * whatever it said when the last one landed. Started only once the browser
   * has a clock reading, and cleared with the component, so a card scrolled off
   * a phone is not still re-rendering every five seconds.
   */
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (refreshedAt === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), FRESHNESS_TICK_MS);
    return () => clearInterval(timer);
  }, [refreshedAt]);

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
        if (cancelled) return;
        setTotals(next);
        // A successful read is fresh whether or not the figure moved, so this
        // is set on every one of them and not only on a change.
        setRefreshedAt(Date.now());
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

  /*
   * Two fills in one track, both measured against the target.
   *
   * The lighter one runs to what has been pledged and the solid one to what has
   * actually arrived, so the gap between them is the money still to come in. A
   * single bar could only ever show one of those, and the congregation has been
   * asking about both: how far the campaign has got, and how much of what was
   * promised has been paid.
   *
   * The pledged fill carries a 24px floor, so that once there is anything to
   * show it is always wide enough to read as a shape rather than as a line. At
   * 7% of a 550 million target it clears that on a laptop and lands exactly on
   * it on a phone; earlier in the campaign it did not clear it anywhere, and a
   * bar that looks empty while the number above it says forty million is how a
   * congregation starts doubting the figure.
   *
   * The received fill gets no floor at all, and that is not an oversight.
   *
   * Floor them both and the two come out the same 24px whenever received is
   * small, which is most of a campaign: the solid campfire covers the apricot
   * exactly and the bar reads as one colour, which is the opposite of what
   * drawing two fills is for. Worse, it would draw a million shillings the same
   * width as forty million. A minimum width on a bar that is only there to be
   * seen is a kindness; a minimum width on money that has actually arrived is a
   * lie about the money, and this is the figure the treasurer reconciles
   * against. Below about half a per cent it stays a sliver, and the legend
   * underneath says the true figure in words.
   */
  const pledgedFill = Math.max(Math.min(totals.percentPledged, 100), 0);
  const receivedFill = Math.min(totals.percentReceived, 100);

  const pledgedWidth =
    BigInt(totals.pledgedMinor) > 0n ? `max(${pledgedFill}%, 24px)` : "0%";

  return (
    /*
     * Full width of the hero's content column on a phone, which lands at
     * roughly 90% of a 360px screen once the hero's own side padding is taken
     * off, and eases back to 90% of a wider column before the 640px ceiling
     * takes over. Padding tightens only on the narrowest screens, where 20px a
     * side starts to eat into the headline.
     */
    <div
      data-spring=""
      className="tracker-card mx-auto w-full max-w-[640px] p-5 text-center max-[400px]:p-4 sm:w-[90%] md:p-8">
      <p className="tabular font-semibold tracking-tight text-white [font-size:clamp(2rem,9vw,4.5rem)] [line-height:1.05]">
        <CountUp value={BigInt(totals.pledgedMinor)} />
      </p>

      {/*
        The target, once, as the second half of the headline's sentence. The
        pledged figure is printed nowhere else on the card: the headline above
        is the only place it appears.
      */}
      <p className="mt-2 text-sm text-white/70 sm:text-base">
        pledged toward{" "}
        <span className="tabular font-semibold whitespace-nowrap text-white/90">
          {formatKES(totals.targetMinor)}
        </span>
      </p>

      <div
        className="tracker-track relative mt-6 h-4 w-full overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={totals.percentPledged}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Pledged against the campaign target"
      >
        {/*
          One progressbar, not two. Nesting a second one inside would have a
          screen reader announce two competing percentages for the same bar;
          the row underneath says both figures in words instead, which is what
          somebody who cannot see the fills actually needs.
        */}
        <div
          aria-hidden
          className="tracker-fill absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
          style={{ width: pledgedWidth }}
        />
        <div
          aria-hidden
          className="tracker-fill-solid absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${receivedFill}%` }}
        />
        {/*
          The shine, last so it travels over both fills rather than under the
          solid one, and sized to the pledged fill so it never sweeps across
          empty track.
        */}
        <div
          aria-hidden
          className="tracker-sweep rounded-full transition-[width] duration-700 ease-out"
          style={{ width: pledgedWidth }}
        />
      </div>

      {/*
        One row of three supporting figures, which is also the bar's legend.

        Each fill's dot sits beside the figure that fill draws: the solid
        campfire beside what has been received, the apricot beside the share of
        the target that has been pledged. Received comes first because it is
        the harder figure, money already in the bank.

        A list rather than a dl, because two of the three read value first
        ("9.80% of goal") and a dt cannot follow its dd. Each item reads as a
        phrase on its own, so a screen reader hears three short items.

        The bullets between them are decoration and only appear once the row
        fits on one line. On a phone the three wrap, and a bullet left at the
        end of a wrapped line reads as a stray mark.
      */}
      <ul className="mt-3 flex flex-wrap items-baseline justify-center gap-x-4 gap-y-1 text-sm text-white/60 sm:gap-x-3">
        <li className="flex items-baseline gap-2">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full bg-campfire"
          />
          <span>
            Received{" "}
            <span className="tabular font-semibold text-white">
              {formatKES(totals.receivedMinor)}
            </span>
          </span>
        </li>
        <Bullet />
        <li className="flex items-baseline gap-2">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full bg-apricot"
          />
          <span>
            <span className="tabular font-semibold text-white">
              {formatPercent(totals.percentPledged)}
            </span>{" "}
            of goal
          </span>
        </li>
        <Bullet />
        <li>
          <span className="tabular font-semibold text-white">
            {formatNumber(totals.pledgeCount)}
          </span>{" "}
          {totals.pledgeCount === 1 ? "pledge" : "pledges"}
        </li>
      </ul>

      {sparkline && (
        <div className="mt-5 text-white/20" aria-hidden>
          {sparkline}
        </div>
      )}

      {/*
        How fresh the figures are.

        Deliberately the quietest thing on the card. It exists so that somebody
        watching the number during an appeal knows the page is live and is not
        showing them something from an hour ago, and for no other reason, so it
        is sized and coloured to be found rather than read.
      */}
      <p className="mt-5 text-xs text-white/40" aria-live="off">
        Updated {freshness(refreshedAt, now)}
      </p>
    </div>
  );
}

/**
 * How long ago the figures on the card were last known good.
 *
 * Its own function rather than formatRelativeTime from lib/format, which
 * rounds everything under a minute to "just now". That is right for a pledge in
 * the feed, whose exact age nobody cares about, and wrong here: the whole
 * interval this line has to describe is the thirty seconds between two polls,
 * and a line that reads "just now" for the entire gap says nothing at all.
 *
 * Rounded to five seconds, which is also how often it is recomputed, so the
 * text never claims a precision the tick behind it does not have.
 */
function freshness(refreshedAt: number | null, now: number): string {
  // Before the browser has a clock reading, which is the server render and the
  // first client paint. The figures came with the page, so this is true.
  if (refreshedAt === null) return "just now";

  const seconds = Math.max(0, Math.round((now - refreshedAt) / 1000));

  if (seconds < 10) return "just now";
  if (seconds < 60) return `${Math.round(seconds / 5) * 5} seconds ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

/**
 * The separator between two figures in the row under the bar.
 *
 * An li because it sits directly inside the ul, and hidden from assistive tech
 * so the list is announced as the three figures and not five items.
 */
function Bullet() {
  return (
    <li aria-hidden className="hidden text-white/30 sm:block">
      •
    </li>
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
