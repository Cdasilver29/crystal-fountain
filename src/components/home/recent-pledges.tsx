"use client";

import { useEffect, useRef, useState } from "react";

import type { RecentPledgeDto } from "@/lib/campaign";
import { formatKES, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The recent pledges feed on the home page.
 *
 * Everybody in this list ticked the box that says a first name and a pledge
 * amount may appear here. Nobody else is in it, in any form: an amount with a
 * timestamp and no name attached is still that person's pledge amount on a
 * public page, and the consent they gave or withheld was about exactly that.
 *
 * The server renders the first list, so the page is right on first paint and
 * with JavaScript switched off. After hydration it polls the same endpoint on
 * the same interval as the tracker above it, and an entry that arrives on a
 * poll fades in. The entries that were already there do not, because they did
 * not just happen, and a list that shimmers every thirty seconds to say nothing
 * changed is worse than a still one.
 *
 * The section removes itself when there is nothing consented to show. An empty
 * "recent pledges" heading on a church home page reads as though nobody has
 * given, which would be both discouraging and untrue.
 */

const POLL_INTERVAL_MS = 30_000;

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

  if (entries.length === 0) return null;

  return (
    <section
      aria-labelledby="recent-pledges-heading"
      className="bg-neutral-50 px-4 py-14 sm:px-6 sm:py-16"
    >
      <div className="mx-auto w-full max-w-3xl">
        <h2
          id="recent-pledges-heading"
          className="text-2xl font-semibold tracking-tight text-navy sm:text-3xl"
        >
          Recent pledges
        </h2>

        <p className="mt-2 text-base text-neutral-600">
          Members who asked to be named here. A pledge is a promise to give, so
          these are commitments rather than payments.
        </p>

        <ul
          // Announced when a poll brings something new, so a member using a
          // screen reader is told rather than having to go looking.
          aria-live="polite"
          className="mt-6 divide-y divide-neutral-200 border-y border-neutral-200"
        >
          {entries.map((entry) => (
            <li
              key={entry.id}
              className={cn(
                "flex items-baseline justify-between gap-4 py-3.5",
                arrived.has(entry.id) && "feed-in",
              )}
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-navy">
                  {entry.firstName}
                </p>
                <p className="text-xs text-neutral-500">
                  {formatRelativeTime(entry.createdAt, now)}
                </p>
              </div>

              <p className="tabular shrink-0 font-semibold text-campfire">
                {formatKES(entry.amountMinor)}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
