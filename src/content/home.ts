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

/**
 * How your gift is protected: six facts from the CD-Fund policy, each linking
 * to the pillar it comes from on /cd-fund. The wording is taken from
 * CD_FUND_PAGE in src/content/cd-fund.ts, shortened to fit a tile and never
 * added to. A tile with a number shows it as its picture; the others name a
 * lucide icon.
 */
export type ProtectionFact = {
  readonly headline: string;
  readonly line: string;
  /** The pillar's number on /cd-fund, which is its anchor: #pillar-<n>. */
  readonly pillar: number;
  readonly figure?: string;
  readonly icon?: "ring-fenced" | "segregation" | "audit" | "investment";
};

export const PROTECTION_FACTS: readonly ProtectionFact[] = [
  {
    figure: "3",
    headline: "Authorised sign-offs on every payment",
    line: "All financial payments, whether digital or physical, require three authorised sign-offs.",
    pillar: 5,
  },
  {
    icon: "segregation",
    headline: "No one person controls a payment",
    line: "No single individual or committee can initiate, authorise, and execute the same payment.",
    pillar: 5,
  },
  {
    figure: "7",
    headline: "Years every record is kept",
    line: "All accounting ledgers, vouchers, and contracts are archived physically and digitally for a statutory period of 7 years.",
    pillar: 5,
  },
  {
    icon: "ring-fenced",
    headline: "The fund is ring-fenced",
    line: "Its assets are separated from the church's day-to-day operational budgets.",
    pillar: 1,
  },
  {
    icon: "audit",
    headline: "An independent audit committee",
    line: "Church experts, excluding board or treasury staff, audit the receipt books, bank reconciliation trails, and mobile logs.",
    pillar: 5,
  },
  {
    icon: "investment",
    headline: "No speculative investments",
    line: "Equities and stocks, cryptocurrencies, and derivatives are explicitly banned.",
    pillar: 3,
  },
];
