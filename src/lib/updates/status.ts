import type { EventSeries, EventSession } from "@/content/updates";

/**
 * Where each session of a series stands, worked out from the clock.
 *
 * Everything here is in Nairobi time and takes `now` as an argument, so the
 * page computes it once on the server and sends the answer as text. The browser
 * never recomputes it, which is what keeps the two from disagreeing on a
 * visitor whose machine is set to another zone, and React from warning on
 * hydration.
 *
 * A session has a start and no end, because none has been given. So a session
 * is "today" for the whole of its day, before and after 5:30pm, and nothing
 * here ever claims one is happening now.
 */

const ZONE = "Africa/Nairobi";
const DAY_MS = 86_400_000;

/** How far ahead "in N days" is still used; past this the date is given. */
const RELATIVE_DAYS_LIMIT = 14;

export type SessionStatus = "held" | "today" | "next" | "upcoming";

/** Status as words. Every tile and chip shows this, never colour alone. */
export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  held: "Held",
  today: "Today",
  next: "Next",
  upcoming: "Upcoming",
};

export type SessionView = EventSession & {
  status: SessionStatus;
  /** The session's day in Nairobi, as YYYY-MM-DD. */
  dayKey: string;
};

export type SeriesView = {
  series: EventSeries;
  sessions: SessionView[];
  /** The session to act on: today's if there is one, else the next. */
  featured: SessionView | null;
  /** "Today, 5:30pm", "Tomorrow, 5:30pm", "in 4 days" or the date. */
  featuredWhen: string | null;
  /** Every session has been held. */
  isPast: boolean;
};

function nairobiParts(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: ZONE,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  ) as Record<"weekday" | "day" | "month" | "year" | "hour" | "minute" | "dayPeriod", string>;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** The Nairobi calendar day of an instant, as YYYY-MM-DD. */
export function nairobiDayKey(value: Date | string): string {
  const parts = nairobiParts(value);
  const month = String(MONTHS.indexOf(parts.month) + 1).padStart(2, "0");
  return `${parts.year}-${month}-${parts.day.padStart(2, "0")}`;
}

/** Whole calendar days from one day key to another. */
function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(toKey) - Date.parse(fromKey)) / DAY_MS);
}

/** A session's date in the pieces the page lays out, in Nairobi time. */
export function sessionDate(startsAt: string) {
  const parts = nairobiParts(startsAt);
  return {
    weekday: parts.weekday,
    day: parts.day,
    month: parts.month,
    monthShort: parts.month.slice(0, 3),
    year: parts.year,
    /** "5:30pm" */
    time: `${parts.hour}:${parts.minute}${parts.dayPeriod.toLowerCase()}`,
    /** "12 October 2026" */
    long: `${parts.day} ${parts.month} ${parts.year}`,
    /** "12 Oct" */
    short: `${parts.day} ${parts.month.slice(0, 3)}`,
    /** "Monday 12 October 2026" */
    full: `${parts.weekday} ${parts.day} ${parts.month} ${parts.year}`,
  };
}

/** When a session is, relative to now, for the featured card. */
export function relativeWhen(startsAt: string, now: Date): string {
  const date = sessionDate(startsAt);
  const days = daysBetween(nairobiDayKey(now), nairobiDayKey(startsAt));
  if (days === 0) return `Today, ${date.time}`;
  if (days === 1) return `Tomorrow, ${date.time}`;
  if (days > 1 && days <= RELATIVE_DAYS_LIMIT) return `in ${days} days`;
  return `${date.weekday} ${date.day} ${date.month}`;
}

/**
 * Held if its day has passed, today if it is today. Of the rest, the first is
 * next and the others upcoming, unless a session is today: then today's is the
 * one to act on and every later session is upcoming.
 */
export function seriesView(series: EventSeries, now: Date): SeriesView {
  const todayKey = nairobiDayKey(now);
  const ordered = [...series.sessions].sort(
    (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
  );

  let featured: SessionView | null = null;
  const sessions = ordered.map((session): SessionView => {
    const dayKey = nairobiDayKey(session.startsAt);
    let status: SessionStatus;
    if (dayKey < todayKey) status = "held";
    else if (dayKey === todayKey) status = "today";
    else status = featured ? "upcoming" : "next";

    const view = { ...session, dayKey, status };
    if (!featured && (status === "today" || status === "next")) featured = view;
    return view;
  });

  const chosen = featured as SessionView | null;
  return {
    series,
    sessions,
    featured: chosen,
    featuredWhen: chosen ? relativeWhen(chosen.startsAt, now) : null,
    isPast: sessions.every((session) => session.status === "held"),
  };
}
