/**
 * Copy used only on the home page, as typed data in the repo. There is no CMS,
 * by design, and nothing here is invented.
 *
 * Its own file because of who imports it. The site header imports
 * src/content/project.ts, src/content/campaign.ts and src/content/cd-fund.ts
 * for the navigation, and the bundler ships each of those whole with the header
 * on every public page. Only server components import this file, so none of it
 * reaches the browser as JavaScript.
 */

/**
 * The line that turns over under the hero headline. The first two are the
 * heading of the first part of ABOUT_PROJECT in src/content/project.ts, and the
 * third is the church's own phrase from the campaign subheading.
 */
export const HERO_PHRASES = [
  "A sanctuary for worship.",
  "A home for generations.",
  "A centre of influence.",
] as const;

/** The drifting band between the commitment section and the timeline. */
export const TEXT_BAND_WORDS = [
  "Pray",
  "Pledge",
  "Redeem",
  "This is My Pledge",
  "#CrystalFountain",
] as const;
