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
   * A short pull quote in his own words, one or two sentences, without
   * quotation marks. Only ever something he has said or approved. Left empty,
   * nothing renders and the layout closes up around the gap.
   */
  quote: string;
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
  quote: "",
};

/**
 * One short paragraph for the home page, cut down from ACCOUNTABILITY in
 * project.ts, which /vision still sets in full. Two lines at desktop width,
 * which is what keeps the section under 320px tall; cut, do not add.
 */
export const OVERSIGHT_SHORT =
  "The church's Development Committee oversees the project and engages professional architects and engineers. Every contribution is acknowledged and accounted for.";
