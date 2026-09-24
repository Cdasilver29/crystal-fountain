import { CONTACT } from "./campaign";

/**
 * The person answerable for the project, as the home page introduces him.
 *
 * Name, role and phone are read from CONTACT rather than repeated, so the
 * number a member dials is written in one place.
 */
export type Leader = {
  name: string;
  role: string;
  phoneDisplay: string;
  phoneHref: string;
  photo: { src: string; alt: string };
  /**
   * His statement, one entry per paragraph, each set as its own line of the
   * pull quote. His own words as he supplied them: do not edit, shorten or
   * rephrase. An empty list renders no quote.
   */
  statement: readonly string[];
};

export const DEVELOPMENT_LEADER: Leader = {
  name: CONTACT.leaderName,
  role: CONTACT.leaderRole,
  phoneDisplay: CONTACT.phoneDisplay,
  phoneHref: CONTACT.phoneHref,
  photo: {
    src: "/images/leadership/steve-mogere.png",
    alt: `${CONTACT.leaderName}, ${CONTACT.leaderRole}`,
  },
  statement: [
    "This project gives us and especially myself, as a professional, an opportunity to create a lasting home for worship and service at Newlife SDA Church.",
    "My hope is that we can transform our worship experience and grow in faith.",
    "We can create a caring church that would nurture our children and young people and welcome others into mission.",
    "Plus, we can invest in mission supportive activities for generational impacts.",
  ],
};

/**
 * One short paragraph for the home page, cut down from ACCOUNTABILITY in
 * project.ts, which /vision still sets in full. Two lines at desktop width,
 * so it stays secondary to his statement; cut, do not add.
 */
export const OVERSIGHT_SHORT =
  "The church's Development Committee oversees the project and engages professional architects and engineers. Every contribution is acknowledged and accounted for.";
