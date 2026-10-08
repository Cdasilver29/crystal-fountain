import { CONTACT } from "./campaign";

/**
 * The updates page, as data.
 *
 * Adding an update means adding an entry here, not writing page code. A post
 * is a dated piece of news; an event series is a run of dated sessions whose
 * status (held, today, next, upcoming) is worked out from the clock, so nobody
 * has to come back and edit it as the dates pass.
 *
 * Wording is the church's own, from its posters. Do not rephrase it.
 */

export type EventVenue = {
  /** The place, as a person would say it. */
  name: string;
  streetAddress: string;
  locality: string;
  /** ISO 3166 country code, for structured data. */
  country: string;
  /** What to search for on a map. */
  mapsQuery: string;
};

export type EventSession = {
  /** One based, in date order. */
  number: number;
  /**
   * The start, as an ISO string with the Nairobi offset written out, for
   * example 2026-10-12T17:30:00+03:00. The offset is part of the contract:
   * a bare date-time would be read in whatever zone the runtime is in.
   */
  startsAt: string;
};

export type EventSeries = {
  /** Stable. Used as the page anchor and in calendar UIDs, so never change it. */
  id: string;
  name: string;
  /** The name in a sentence or an email subject, for example "Professionals Forum". */
  shortName: string;
  organiser: string;
  venue: EventVenue;
  /** The start time as it is printed, for example "5:30pm". */
  timeLabel: string;
  /** A one line note under the series, if the sessions follow a pattern. */
  scheduleNote?: string;
  /** Where attendance is confirmed. */
  attendanceEmail: string;
  /**
   * No end time has been given for any session, so there is no field for one.
   * Add a duration here if the church supplies one.
   */
  sessions: readonly EventSession[];
};

export type PostKind = "announcement" | "progress" | "event";

export type Post = {
  /** Stable, used as the post's anchor. */
  slug: string;
  title: string;
  /** The day it was posted, as YYYY-MM-DD in Nairobi time. */
  postedOn: string;
  kind: PostKind;
  /** One entry per paragraph. */
  body: readonly string[];
  /** The id of the event series this post is about, if any. */
  seriesId?: string;
};

const NEWLIFE_ADVENTIST_CHURCH: EventVenue = {
  name: "Newlife Adventist Church",
  streetAddress: "5th Ngong Avenue",
  locality: "Nairobi",
  country: "KE",
  mapsQuery: "Newlife Adventist Church, 5th Ngong Avenue, Nairobi",
};

export const eventSeries: readonly EventSeries[] = [
  {
    id: "professionals-forum",
    name: "Crystal Fountain Professionals Forum",
    shortName: "Professionals Forum",
    organiser: "the Newlife Development Team",
    venue: NEWLIFE_ADVENTIST_CHURCH,
    timeLabel: "5:30pm",
    scheduleNote: "Every session is on a Monday at 5:30pm.",
    attendanceEmail: CONTACT.developmentEmail,
    sessions: [
      { number: 1, startsAt: "2026-09-28T17:30:00+03:00" },
      { number: 2, startsAt: "2026-10-12T17:30:00+03:00" },
      { number: 3, startsAt: "2026-10-26T17:30:00+03:00" },
      { number: 4, startsAt: "2026-11-09T17:30:00+03:00" },
    ],
  },
];

/** Newest first is the page's job; the order here does not matter. */
export const posts: readonly Post[] = [
  {
    slug: "a-call-for-professionals",
    title: "A call for professionals",
    postedOn: "2026-10-08",
    kind: "announcement",
    body: [
      "Progress toward building a new sanctuary and centre of influence continues! The Newlife Development Team invites professionals to continued consultative forums and sharing of ideas.",
      `Attendance is confirmed by email to ${CONTACT.developmentEmail}.`,
    ],
    seriesId: "professionals-forum",
  },
];

export function findSeries(id: string): EventSeries | undefined {
  return eventSeries.find((series) => series.id === id);
}
