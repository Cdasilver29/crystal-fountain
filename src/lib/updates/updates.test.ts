import { describe, expect, it, vi } from "vitest";

import { type EventSeries, eventSeries, findSeries, posts } from "@/content/updates";

import { sessionEventSchema } from "@/lib/structured-data";

import { sessionCalendar, sessionUid } from "./ics";
import {
  attendanceMailto,
  calendarPath,
  directionsUrl,
  shareText,
  whatsappShareUrl,
} from "./links";
import {
  featuredChip,
  formatDayKey,
  nairobiDayKey,
  relativeWhen,
  seriesView,
  sessionDate,
} from "./status";

// structured-data reads SITE_URL, which would otherwise validate the whole env.
vi.mock("@/lib/metadata", () => ({ SITE_URL: "https://pledge.example.org" }));

const forum = findSeries("professionals-forum")!;
const [s1, s2, s3, s4] = forum.sessions;

/** An instant given in Nairobi wall time. */
const at = (nairobi: string) => new Date(`${nairobi}+03:00`);

const statuses = (now: Date) => seriesView(forum, now).sessions.map((s) => s.status);

describe("content", () => {
  it("writes every start with the Nairobi offset, numbered in date order", () => {
    for (const series of eventSeries) {
      series.sessions.forEach((session, index) => {
        expect(session.startsAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+03:00$/);
        expect(session.number).toBe(index + 1);
        expect(sessionDate(session.startsAt).time).toBe(series.timeLabel);
      });
    }
  });

  it("links every post to a series that exists", () => {
    for (const post of posts) {
      if (post.seriesId) expect(findSeries(post.seriesId)).toBeDefined();
      expect(post.postedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("puts every forum session on a Monday at 5:30pm", () => {
    for (const session of forum.sessions) {
      expect(sessionDate(session.startsAt).weekday).toBe("Monday");
    }
  });
});

describe("seriesView", () => {
  it("on 8 October 2026 shows Session 1 held and Session 2 next", () => {
    const view = seriesView(forum, at("2026-10-08T10:00:00"));
    expect(view.sessions.map((s) => s.status)).toEqual(["held", "next", "upcoming", "upcoming"]);
    expect(view.featured?.number).toBe(2);
    expect(view.featuredWhen).toBe("in 4 days");
    expect(view.isPast).toBe(false);
  });

  it("marks a session today for the whole of its Nairobi day, and later ones upcoming", () => {
    expect(statuses(at("2026-10-12T00:00:00"))).toEqual(["held", "today", "upcoming", "upcoming"]);
    expect(statuses(at("2026-10-12T17:30:00"))).toEqual(["held", "today", "upcoming", "upcoming"]);
    expect(statuses(at("2026-10-12T23:59:59"))).toEqual(["held", "today", "upcoming", "upcoming"]);
    const view = seriesView(forum, at("2026-10-12T20:00:00"));
    expect(view.featured?.number).toBe(2);
    expect(view.featuredWhen).toBe("Today, 5:30pm");
  });

  it("turns a session to held at Nairobi midnight, not UTC midnight", () => {
    // 21:00 UTC on 12 October is already midnight on the 13th in Nairobi.
    expect(statuses(new Date("2026-10-12T20:59:59Z"))[1]).toBe("today");
    expect(statuses(new Date("2026-10-12T21:00:00Z"))).toEqual(["held", "held", "next", "upcoming"]);
    // 22:00 UTC on 11 October is 01:00 on the 12th in Nairobi.
    expect(statuses(new Date("2026-10-11T20:59:59Z"))[1]).toBe("next");
    expect(statuses(new Date("2026-10-11T22:00:00Z"))[1]).toBe("today");
  });

  it("keeps the final session today on its day, then the series is past", () => {
    const lastDay = seriesView(forum, at("2026-11-09T19:00:00"));
    expect(lastDay.sessions.map((s) => s.status)).toEqual(["held", "held", "held", "today"]);
    expect(lastDay.isPast).toBe(false);

    const after = seriesView(forum, at("2026-11-10T00:00:00"));
    expect(after.sessions.every((s) => s.status === "held")).toBe(true);
    expect(after.featured).toBeNull();
    expect(after.featuredWhen).toBeNull();
    expect(after.isPast).toBe(true);
  });

  it("before the first session, it is next and the rest upcoming", () => {
    expect(statuses(at("2026-09-01T09:00:00"))).toEqual(["next", "upcoming", "upcoming", "upcoming"]);
  });

  it("orders sessions by start even if the content does not", () => {
    const shuffled: EventSeries = { ...forum, sessions: [s3!, s1!, s4!, s2!] };
    const view = seriesView(shuffled, at("2026-10-08T10:00:00"));
    expect(view.sessions.map((s) => s.number)).toEqual([1, 2, 3, 4]);
    expect(view.featured?.number).toBe(2);
  });
});

describe("relativeWhen", () => {
  const start = s2!.startsAt;
  it("words the next session by calendar days in Nairobi", () => {
    expect(relativeWhen(start, at("2026-10-12T06:00:00"))).toBe("Today, 5:30pm");
    expect(relativeWhen(start, at("2026-10-11T23:59:00"))).toBe("Tomorrow, 5:30pm");
    expect(relativeWhen(start, at("2026-10-11T00:01:00"))).toBe("Tomorrow, 5:30pm");
    expect(relativeWhen(start, at("2026-10-10T23:59:00"))).toBe("in 2 days");
    expect(relativeWhen(start, at("2026-09-28T12:00:00"))).toBe("in 14 days");
    expect(relativeWhen(start, at("2026-09-27T12:00:00"))).toBe("Monday 12 October");
  });

  it("never says now or live", () => {
    for (const hour of ["00", "12", "17", "18", "23"]) {
      expect(relativeWhen(start, at(`2026-10-12T${hour}:30:00`))).not.toMatch(/now|live/i);
    }
  });
});

describe("nairobiDayKey", () => {
  it("reads the day in Nairobi, not in UTC", () => {
    expect(nairobiDayKey(new Date("2026-10-11T21:00:00Z"))).toBe("2026-10-12");
    expect(nairobiDayKey(new Date("2026-10-11T20:59:59Z"))).toBe("2026-10-11");
    expect(nairobiDayKey("2026-09-28T17:30:00+03:00")).toBe("2026-09-28");
  });
});

describe("links", () => {
  it("builds the attendance mailto with an encoded subject and body", () => {
    const href = attendanceMailto(forum, s2!);
    expect(href).toBe(
      "mailto:churchdevelopment@newlifesdanairobi.org" +
        "?subject=Attendance%3A%20Professionals%20Forum%2C%20Session%202%2C%2012%20October%202026" +
        "&body=Name%3A%0D%0AProfession%3A%0D%0APhone%3A",
    );
    const url = new URL(href);
    expect(decodeURIComponent(url.search.match(/subject=([^&]*)/)![1]!)).toBe(
      "Attendance: Professionals Forum, Session 2, 12 October 2026",
    );
    expect(href).not.toContain("+");
  });

  it("searches the venue on Google Maps without a key", () => {
    expect(directionsUrl(forum)).toBe(
      "https://www.google.com/maps/search/?api=1&query=Newlife%20Adventist%20Church%2C%205th%20Ngong%20Avenue%2C%20Nairobi",
    );
  });

  it("shares the series, session, date, time, venue and the anchored page", () => {
    const text = shareText(forum, s2!, "https://pledge.example.org/");
    expect(text).toBe(
      [
        "Crystal Fountain Professionals Forum, Session 2 of 4",
        "Monday 12 October 2026, 5:30pm",
        "Newlife Adventist Church, 5th Ngong Avenue",
        "https://pledge.example.org/updates#professionals-forum",
      ].join("\n"),
    );
    const share = new URL(whatsappShareUrl(text));
    expect(share.origin).toBe("https://wa.me");
    expect(share.searchParams.get("text")).toBe(text);
  });

  it("points the calendar link at a same-origin path", () => {
    expect(calendarPath(forum, s2!)).toBe(
      "/api/updates/professionals-forum/session-2/calendar.ics",
    );
  });
});

describe("sessionCalendar", () => {
  const ics = sessionCalendar(forum, s2!, {
    siteUrl: "https://pledge.example.org",
    stampedAt: new Date("2026-10-08T07:00:00Z"),
  });
  const lines = ics.split("\r\n");

  it("starts at 17:30 Nairobi, which is 14:30 UTC, with no end", () => {
    expect(lines).toContain("DTSTART:20261012T143000Z");
    expect(ics).not.toMatch(/DTEND|DURATION/);
  });

  it("carries a stable UID, the title, the venue and the attendance email", () => {
    expect(lines).toContain("UID:professionals-forum-session-2@newlifesdanairobi.org");
    expect(sessionUid(forum, s2!)).not.toBe(sessionUid(forum, s3!));
    expect(lines).toContain("SUMMARY:Crystal Fountain Professionals Forum\\, Session 2 of 4");
    expect(lines).toContain("LOCATION:Newlife Adventist Church\\, 5th Ngong Avenue\\, Nairobi");
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("churchdevelopment@newlifesdanairobi.org");
    expect(unfolded).toContain("https://pledge.example.org/updates#professionals-forum");
  });

  it("uses CRLF and folds every line to 75 octets", () => {
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    for (const line of lines) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines.at(-2)).toBe("END:VCALENDAR");
  });
});

describe("featuredChip", () => {
  it("names the next session, or the one today", () => {
    expect(featuredChip(seriesView(forum, at("2026-10-08T10:00:00")))).toBe("Next session, in 4 days");
    expect(featuredChip(seriesView(forum, at("2026-10-11T10:00:00")))).toBe(
      "Next session, tomorrow, 5:30pm",
    );
    expect(featuredChip(seriesView(forum, at("2026-10-12T10:00:00")))).toBe("Today, 5:30pm");
    expect(featuredChip(seriesView(forum, at("2026-10-13T10:00:00")))).toBe(
      "Next session, in 13 days",
    );
    expect(featuredChip(seriesView(forum, at("2026-11-10T10:00:00")))).toBeNull();
  });
});

describe("formatDayKey", () => {
  it("formats a posted date without a zone", () => {
    expect(formatDayKey("2026-10-08")).toBe("8 October 2026");
  });
});

describe("sessionEventSchema", () => {
  it("describes an offline event at the venue with the Nairobi offset and no end", () => {
    const schema = sessionEventSchema(forum, s2!);
    expect(schema["@type"]).toBe("Event");
    expect(schema.startDate).toBe("2026-10-12T17:30:00+03:00");
    expect(schema.eventAttendanceMode).toBe("https://schema.org/OfflineEventAttendanceMode");
    expect(schema.location.address.streetAddress).toBe("5th Ngong Avenue");
    expect(schema.organizer.name).toBe("Newlife Development Team");
    expect(schema).not.toHaveProperty("endDate");
  });
});
