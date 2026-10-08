import { CONTACT } from "@/content/campaign";
import type { EventSeries, EventSession } from "@/content/updates";

import { seriesPath, sessionOrdinal } from "./links";

/**
 * An iCalendar file (RFC 5545) for one session.
 *
 * DTSTART is written in UTC with a Z. Every calendar converts that to the
 * reader's own zone, and it spares the file a VTIMEZONE block for a zone that
 * has not changed its offset since 1960.
 *
 * There is no DTEND and no DURATION, because the church has given no end time.
 * RFC 5545 reads that as an event of no length at its start, which calendars
 * show as a 5:30pm entry. If the church supplies a duration, add DURATION here.
 */

/** Never changes for a session, so a re-download updates the entry, not duplicates it. */
export function sessionUid(series: EventSeries, session: EventSession): string {
  return `${series.id}-session-${session.number}@${CONTACT.siteLabel}`;
}

/** 20261012T143000Z */
function utcStamp(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Backslash, semicolon, comma and line breaks are escaped in a TEXT value. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Lines longer than 75 octets are folded: CRLF and a space. Counted in UTF-8
 * bytes, and never inside a character.
 */
function fold(line: string): string {
  const encoder = new TextEncoder();
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

export function sessionCalendar(
  series: EventSeries,
  session: EventSession,
  options: { siteUrl: string; stampedAt: Date },
): string {
  const url = `${options.siteUrl.replace(/\/$/, "")}${seriesPath(series)}`;
  const location = `${series.venue.name}, ${series.venue.streetAddress}, ${series.venue.locality}`;
  const description = [
    `Organised by ${series.organiser}.`,
    `Attendance is confirmed by email to ${series.attendanceEmail}.`,
    url,
  ].join("\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${CONTACT.churchName}//Crystal Fountain//EN`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${sessionUid(series, session)}`,
    `DTSTAMP:${utcStamp(options.stampedAt)}`,
    `DTSTART:${utcStamp(session.startsAt)}`,
    `SUMMARY:${escapeText(`${series.name}, ${sessionOrdinal(series, session)}`)}`,
    `LOCATION:${escapeText(location)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `URL:${url}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** "professionals-forum-session-2.ics" */
export function sessionCalendarFilename(series: EventSeries, session: EventSession): string {
  return `${series.id}-session-${session.number}.ics`;
}
