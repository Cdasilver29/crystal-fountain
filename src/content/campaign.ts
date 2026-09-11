/**
 * Campaign content as typed data in the repo. There is no CMS, by design.
 *
 * Every figure here was confirmed by the church. Payment details in particular
 * are the ones a member will type into their phone, so they live in one place
 * and are read from it everywhere rather than retyped per page.
 *
 * Note: the campaign target and any money total are NOT here. Totals are always
 * read from the database. See src/server/services/campaign.ts.
 */

export const CAMPAIGN = {
  name: "Crystal Fountain Development Project",
  shortName: "Crystal Fountain",
  subheading: "Building a New Sanctuary & Centre of Influence",
  tagline: "This is My Pledge",
  launchDate: "12 September 2026",
  hashtags: ["#ThisIsMyPledge", "#CrystalFountain"],
} as const;

export const SCRIPTURE = {
  text: "Commit thy way unto the Lord; trust also in Him; and He shall bring it to pass.",
  reference: "Psalm 37:5",
} as const;

export const MPESA = {
  paybill: "861200",
  account: "Church Development Fund",
} as const;

/**
 * What to type into M-Pesa, with the pledger's own reference in the account
 * field when there is one.
 *
 * The account number is what the treasury matches a payment against, and a
 * reference identifies one pledge where the fund name identifies only the fund.
 * That is what the 12 character cap on the reference format exists for: it has
 * to fit Daraja's AccountReference field.
 *
 * Somebody giving without having pledged has no reference, and they still need
 * to be able to pay, so the fund name stays as the fallback.
 */
export function mpesaSteps(reference?: string): readonly string[] {
  return [
    "Go to M-Pesa > Lipa na M-Pesa > Pay Bill",
    `Business Number: ${MPESA.paybill}`,
    `Account Number: ${reference ?? MPESA.account}`,
    "Enter Amount",
    "Enter PIN and confirm",
  ];
}

export const MPESA_STEPS: readonly string[] = mpesaSteps();

export const BANK = {
  accountName: "Newlife SDA Church",
  bank: "Standard Chartered Bank",
  branch: "Kenyatta Avenue",
  accountNumber: "0102022990600",
  swift: "SCBLKENX",
  branchCode: "006",
} as const;

export const CONTACT = {
  leaderName: "Dr. Steve Mogere",
  leaderRole: "Development Leader",
  phoneDisplay: "0722619788",
  phoneHref: "tel:+254722619788",
  churchName: "Newlife SDA Church",
  address: "5th Ngong Avenue, Nairobi",
  email: "info@newlifesdanairobi.org",
  // The development office, for anything about this project specifically. The
  // address above is the church's general one and stays where it is used.
  developmentEmail: "churchdevelopment@newlifesdanairobi.org",
  siteUrl: "https://newlifesdanairobi.org",
  siteLabel: "newlifesdanairobi.org",
} as const;

/**
 * The project summary. Confirmed copy, with the em dash replaced by a colon
 * because CLAUDE.md rules em dashes out of all copy.
 */
export const PROJECT_SUMMARY =
  "The Crystal Fountain Development is more than a building project. It is a permanent home for this congregation: a sanctuary designed for 3,000 to 5,000 worshippers, with basement parking for 700 vehicles, classrooms, a library, offices, and landscaped grounds. Alongside the sanctuary, a mixed-use tower will generate income to sustain the ministry for generations.";

export type ProjectStat = { value: string; label: string };

export function projectStats(year: number): ProjectStat[] {
  return [
    { value: "3,000 to 5,000", label: "Worshippers seated" },
    { value: "700", label: "Parking spaces" },
    { value: "KES 550M", label: "Campaign target" },
    { value: String(year), label: "Campaign year" },
  ];
}

/** Used for Open Graph on every page. */
export const OG = {
  title: "Crystal Fountain Development Project: This is My Pledge",
  description:
    "Building a new sanctuary and centre of influence for Newlife SDA Church, Nairobi. Make your pledge today.",
  image: "/images/image1.jpeg",
  imageAlt:
    "Crystal Fountain Development Project, This is My Pledge, launch of the Church Development Fund on 12 September 2026",
} as const;
