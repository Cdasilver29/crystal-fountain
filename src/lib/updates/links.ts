import type { EventSeries, EventSession } from "@/content/updates";

import { sessionDate } from "./status";

/**
 * The links behind a session's actions: confirm attendance, directions and
 * share. Plain strings built from the content, so the page needs no script for
 * any of them and none of them loads anything from a third party until the
 * visitor follows it.
 */

/** "Session 2 of 4" */
export function sessionOrdinal(series: EventSeries, session: EventSession): string {
  return `Session ${session.number} of ${series.sessions.length}`;
}

/** The anchor on /updates that points straight at a series' card. */
export function seriesPath(series: EventSeries): string {
  return `/updates#${series.id}`;
}

/** Where the session's calendar file is served. */
export function calendarPath(series: EventSeries, session: EventSession): string {
  return `/api/updates/${series.id}/session-${session.number}/calendar.ics`;
}

/**
 * A mailto link to confirm attendance, with the subject naming the session and
 * a body for the sender to fill in.
 *
 * Encoded with encodeURIComponent rather than URLSearchParams: mail clients
 * read a "+" in a mailto query literally, so a space must be %20. Line breaks
 * are CRLF, as RFC 6068 asks.
 */
export function attendanceMailto(series: EventSeries, session: EventSession): string {
  const subject = `Attendance: ${series.shortName}, Session ${session.number}, ${sessionDate(session.startsAt).long}`;
  const body = ["Name:", "Profession:", "Phone:"].join("\r\n");
  return `mailto:${series.attendanceEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** A Google Maps search for the venue. No Maps API, no key. */
export function directionsUrl(series: EventSeries): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(series.venue.mapsQuery)}`;
}

/** What a share says: the series, the session, when, where and the link. */
export function shareText(
  series: EventSeries,
  session: EventSession,
  siteUrl: string,
): string {
  const date = sessionDate(session.startsAt);
  return [
    `${series.name}, ${sessionOrdinal(series, session)}`,
    `${date.full}, ${date.time}`,
    `${series.venue.name}, ${series.venue.streetAddress}`,
    `${siteUrl.replace(/\/$/, "")}${seriesPath(series)}`,
  ].join("\n");
}

/** The WhatsApp share link, and the fallback where the Web Share API is absent. */
export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
