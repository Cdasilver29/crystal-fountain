"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { RecentPledgeDto } from "@/lib/campaign";
import { formatKES, formatRelativeTime } from "@/lib/format";

/**
 * The recent pledges scroller, a slim band directly under the hero.
 *
 * Everybody in this list ticked the box that says a name and a pledge amount
 * may appear here. Nobody else is in it, in any form: an amount with a
 * timestamp and no name attached is still that person's pledge amount on a
 * public page, and the consent they gave or withheld was about exactly that.
 * What appears is a given name and at most one letter of a surname, rendered by
 * src/server/display-name.ts before it ever reaches this component. Enough to
 * tell two Marys apart, not enough to identify either to a stranger.
 *
 * It sits on the same navy as the hero and shows three rows, so it reads as the
 * tracker's last line rather than as a section arguing with it. The column
 * drifts upward at 25 pixels a second, slow enough to read a name as it passes,
 * and the entries are in the DOM twice so the drift can loop without a seam:
 * when the first copy has gone fully past, the offset drops by one copy's
 * height and the second copy is already sitting exactly where the first was.
 *
 * Under the cursor or a finger it stops being an animation and becomes a list.
 * The drift pauses and the window turns into an ordinary scrollable element, so
 * somebody who saw a name go by can go back for it. A minute after they let go
 * it returns to the newest entry and picks the drift back up.
 *
 * The server renders the first thirty entries, so the page is right on first
 * paint and with JavaScript switched off. After hydration it polls the same
 * endpoint on the same interval as the tracker above it, and an entry that
 * arrives on a poll fades in. The entries that were already there do not,
 * because they did not just happen.
 *
 * The section removes itself when there are fewer than four consented entries.
 * An empty "recent pledges" heading on a church home page reads as though
 * nobody has given, and three names looping every few seconds reads as a
 * broken animation. Both are worse than no band at all.
 */

const POLL_INTERVAL_MS = 30_000;

/** Pixels per second the column drifts while nobody is touching it. */
const DRIFT_PX_PER_SECOND = 25;

/** How long the window stays a plain list after the last interaction. */
const IDLE_BEFORE_RETURN_MS = 60_000;

/** How long the scroll back to the newest entry takes. */
const RETURN_MS = 800;

/** Below this many consented entries the band does not render. */
const MINIMUM_ENTRIES = 4;

/** Ease in out cubic, for the return. Starts and ends still. */
function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export function RecentPledges({
  initial,
  renderedAt,
}: {
  initial: RecentPledgeDto[];
  /**
   * When the server rendered this, as an ISO string.
   *
   * The relative times are worked out against it rather than against the
   * client's clock, so the server's markup and the first client render agree
   * and React has no hydration mismatch to report. The effect below replaces it
   * with the real time immediately afterwards.
   */
  renderedAt: string;
}) {
  const [entries, setEntries] = useState(initial);
  const [now, setNow] = useState(() => new Date(renderedAt));

  /**
   * The ids that arrived on a poll rather than with the page.
   *
   * State, not a ref, because it decides what is rendered. Set only inside the
   * poll below, never while rendering: computing it during render would clear
   * it again on the next re-render and strip the animation off a row halfway
   * through it.
   */
  const [arrived, setArrived] = useState<ReadonlySet<string>>(new Set());

  const seen = useRef(new Set(initial.map((entry) => entry.id)));

  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      if (cancelled) return;

      // The clock moves whether or not the list does, so "2 hours ago" keeps
      // up on a page left open even when nothing new has been pledged.
      setNow(new Date());

      if (document.visibilityState !== "visible") return;

      try {
        const response = await fetch("/api/campaign/recent", {
          cache: "no-store",
        });
        if (!response.ok) return;

        const next = (await response.json()) as RecentPledgeDto[];
        if (cancelled) return;

        const fresh = next.filter((entry) => !seen.current.has(entry.id));
        for (const entry of next) seen.current.add(entry.id);

        setEntries(next);
        if (fresh.length > 0) {
          setArrived(new Set(fresh.map((entry) => entry.id)));
        }
      } catch {
        // Offline, or a flaky connection. Keep the last list rather than
        // emptying a section that says pledges are arriving.
      }
    }

    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  /*
   * The drift.
   *
   * Everything in here is imperative and works on the two refs directly. None
   * of it is React state on purpose: a transform that changes sixty times a
   * second must not put a render through the reconciler sixty times a second,
   * and nothing above depends on where the column has got to.
   */
  useEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;

    /*
     * Reduced motion gets none of this. No drift, no return, and the script
     * never touches overflow, so the stylesheet's own rule is what makes the
     * window a plain scrollable list of the same height.
     */
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    /** How far up the column has drifted, in pixels, always >= 0. */
    let offset = 0;

    /** The height of one copy of the list. The loop resets on this. */
    let copyHeight = copyRef.current?.offsetHeight ?? 0;

    /** True while a cursor, finger or focus is on the window. */
    let engaged = false;

    /** True while the 800ms return is running, which suppresses everything. */
    let returning = false;

    /** Where the drift was when it paused, to tell a scroll from a hover. */
    let pausedAt = 0;

    let rafId: number | null = null;
    let lastTs: number | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    function measure() {
      copyHeight = copyRef.current?.offsetHeight ?? 0;
    }

    function paint() {
      if (track) track.style.transform = `translate3d(0, ${-offset}px, 0)`;
    }

    function frame(ts: number) {
      rafId = requestAnimationFrame(frame);

      // The first frame after a start only establishes the baseline. Without
      // this, coming back from a hidden tab would hand the loop the whole time
      // it was away as one delta and throw the column halfway up the list.
      if (lastTs === null) {
        lastTs = ts;
        return;
      }

      const elapsed = ts - lastTs;
      lastTs = ts;

      if (copyHeight <= 0) return;

      offset += (DRIFT_PX_PER_SECOND * elapsed) / 1000;
      // One copy has gone fully past. The second copy is sitting exactly where
      // the first was, so dropping a copy's height lands on an identical
      // picture and there is nothing to see.
      if (offset >= copyHeight) offset %= copyHeight;

      paint();
    }

    function start() {
      if (rafId !== null || engaged || returning) return;
      lastTs = null;
      rafId = requestAnimationFrame(frame);
    }

    function stop() {
      if (rafId === null) return;
      cancelAnimationFrame(rafId);
      rafId = null;
      lastTs = null;
    }

    function clearIdle() {
      if (idleTimer === null) return;
      clearTimeout(idleTimer);
      idleTimer = null;
    }

    function armIdle() {
      clearIdle();
      idleTimer = setTimeout(returnToNewest, IDLE_BEFORE_RETURN_MS);
    }

    /*
     * Hand the column over to the browser's own scrolling.
     *
     * The three writes below happen in one task, so the browser paints once,
     * after all of them. The transform comes off and the same number goes into
     * scrollTop, which means the pixel the reader was looking at does not move.
     */
    function engage() {
      clearIdle();

      if (!engaged && !returning && viewport && track) {
        engaged = true;
        stop();
        pausedAt = offset;
        viewport.style.overflowY = "auto";
        track.style.transform = "none";
        viewport.scrollTop = offset;
      }
    }

    /** Take it back and resume drifting from wherever `offset` now is. */
    function release() {
      if (!viewport || !track) return;
      engaged = false;
      returning = false;
      viewport.scrollTop = 0;
      paint();
      // Back to the stylesheet's hidden rather than a second inline value, so
      // the reduced motion rule is not permanently outranked by this one.
      viewport.style.overflowY = "";
      if (document.visibilityState === "visible") start();
    }

    function returnToNewest() {
      clearIdle();
      if (!engaged || returning || !viewport) return;

      const from = viewport.scrollTop;

      // They hovered but never scrolled. There is nothing to animate back
      // from, so pick the drift up where it stopped rather than yanking the
      // column to the top for no reason.
      if (Math.abs(from - pausedAt) < 1) {
        offset = pausedAt;
        release();
        return;
      }

      returning = true;
      const startedAt = performance.now();

      function step(ts: number) {
        if (!viewport) return;
        const progress = Math.min((ts - startedAt) / RETURN_MS, 1);
        viewport.scrollTop = from * (1 - ease(progress));

        if (progress < 1) {
          requestAnimationFrame(step);
          return;
        }

        offset = 0;
        release();
      }

      requestAnimationFrame(step);
    }

    function onScroll() {
      // Our own return writes scrollTop, and that fires this. Re-arming the
      // idle timer from it would cancel the return halfway through.
      if (returning) return;
      if (engaged) armIdle();
    }

    function onVisibility() {
      if (document.visibilityState === "visible") start();
      else stop();
    }

    function onResize() {
      measure();
      if (copyHeight > 0 && offset >= copyHeight) offset %= copyHeight;
      if (!engaged && !returning) paint();
    }

    // pointerenter and pointerleave cover mouse, pen and touch in one pair.
    // touchstart is here as well because a tap on a phone engages without ever
    // producing a pointerenter in some Android browsers.
    viewport.addEventListener("pointerenter", engage);
    viewport.addEventListener("pointerleave", armIdle);
    viewport.addEventListener("touchstart", engage, { passive: true });
    viewport.addEventListener("touchend", armIdle, { passive: true });
    viewport.addEventListener("focusin", engage);
    viewport.addEventListener("focusout", armIdle);
    viewport.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", onResize);

    measure();
    start();

    return () => {
      stop();
      clearIdle();
      viewport.removeEventListener("pointerenter", engage);
      viewport.removeEventListener("pointerleave", armIdle);
      viewport.removeEventListener("touchstart", engage);
      viewport.removeEventListener("touchend", armIdle);
      viewport.removeEventListener("focusin", engage);
      viewport.removeEventListener("focusout", armIdle);
      viewport.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
    };
    // The list length changes what one copy measures, so the loop is rebuilt
    // when it does. Thirty entries change a few times an hour at most.
  }, [entries.length]);

  if (entries.length < MINIMUM_ENTRIES) return null;

  const rows = entries.map((entry) => (
    <li
      key={entry.id}
      className={`cf-feed-row flex items-center justify-between gap-4 ${
        arrived.has(entry.id) ? "feed-in" : ""
      }`}
    >
      <p className="min-w-0 truncate whitespace-nowrap">
        <span className="text-sm font-medium text-white sm:text-base">
          {entry.displayName}
        </span>
        <span className="ml-2 text-xs text-white/45">
          {formatRelativeTime(entry.createdAt, now)}
        </span>
      </p>

      <p className="tabular shrink-0 text-sm font-semibold text-apricot sm:text-base">
        {formatKES(entry.amountMinor)}
      </p>
    </li>
  ));

  return (
    <section
      aria-labelledby="recent-pledges-heading"
      className="cf-feed bg-navy px-4 pt-2 pb-6 sm:px-6 sm:pb-7"
    >
      <div className="mx-auto w-full max-w-3xl">
        {/*
          The link sits on the heading's own line rather than under the window.
          The band is capped at 240px on a desktop and 220px on a phone and it
          already measures 218 and 202, so a line of its own would not fit
          without making the window shorter, and three rows is the window. On
          the heading line it costs nothing.
        */}
        <div className="flex items-center justify-between gap-4">
          {/*
            Both are pills rather than loose text. At 11px on 45 per cent white
            they were legible in a screenshot and invisible on a phone in
            daylight, which is where this page is actually read. A panel gives
            each an edge of its own against the navy, and the type goes up to
            12px at full strength.

            The heading stays quiet and the link carries the warm colour,
            because only one of the two is something to press.
          */}
          <h2
            id="recent-pledges-heading"
            className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs leading-4 font-semibold tracking-[0.1em] text-white/90"
          >
            Recent pledges
          </h2>

          <Link
            href="/pledgers"
            className="inline-flex shrink-0 items-center rounded-full border border-campfire/40 bg-campfire/15 px-3 py-1.5 text-xs leading-4 font-semibold text-apricot transition-colors hover:border-campfire/70 hover:bg-campfire/25 hover:text-white focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-offset-2 focus-visible:ring-offset-navy focus-visible:outline-none"
          >
            See all pledges
          </Link>
        </div>

        <div
          ref={viewportRef}
          // Focusable because it becomes a scroll container, and a scroll
          // container a mouse can reach but a keyboard cannot is a trap for
          // anybody not using one. Focus engages it exactly as hover does.
          tabIndex={0}
          className="cf-feed-window mt-2.5 focus-visible:ring-1 focus-visible:ring-white/40 focus-visible:outline-none"
        >
          <div ref={trackRef} className="cf-feed-track">
            {/*
              Announced when a poll brings something new, so a member using a
              screen reader is told rather than having to go looking. Only this
              copy: the duplicate exists for the drift and has nothing to say.

              Additions only. The default also announces changed text, and
              every poll moves the clock the relative times are worked out
              against, so "4 minutes ago" turning into "5 minutes ago" on any
              row was being read out every thirty seconds.
            */}
            <ul ref={copyRef} aria-live="polite" aria-relevant="additions">
              {rows}
            </ul>
            <ul aria-hidden className="cf-feed-clone">
              {rows}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
