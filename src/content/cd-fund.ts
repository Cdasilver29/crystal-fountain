/**
 * The Church Development Fund policy, as typed data in the repo. There is no
 * CMS, by design, and this file follows the same rule as src/content/project.ts.
 *
 * The source is the church's CD-Fund policy document, the summary of which is
 * the PDF in public/documents. Its headings are set in capitals and its
 * sub-items in title case; both are rendered in sentence case here because
 * CLAUDE.md rules out all-caps labels. Em dashes in the source are rendered as
 * a comma or a colon for the same reason. Nothing else is reworded.
 */

/**
 * The fund page in the navigation. One entry, used by the hero, the phone
 * drawer and the desktop header, so the three cannot drift apart.
 */
export const CD_FUND = {
  href: "/cd-fund",
  label: "CD-Fund",
} as const;

/**
 * A bullet inside a pillar. `term` is the bold lead-in where the source has
 * one; the funding channels in pillar two are plain sentences and have none.
 */
export type CdFundBullet = { readonly term?: string; readonly text: string };

export type CdFundPillar = {
  /** Printed in the marker beside the heading. */
  readonly number: number;
  readonly heading: string;
  readonly lead: string;
  readonly bullets: readonly CdFundBullet[];
};

/*
 * Annotated rather than written `as const satisfies`, which is the pattern in
 * src/content/project.ts. That pattern narrows every bullet to its own literal
 * type, and a union of one object with `term` and another without has no
 * `term` to read, so the renderer cannot ask whether a bullet has a lead-in.
 */
export const CD_FUND_PAGE: {
  readonly title: string;
  readonly tagline: string;
  readonly introHeading: string;
  readonly intro: readonly string[];
  readonly pillarsHeading: string;
  readonly pillars: readonly CdFundPillar[];
} = {
  title: "Church Development Fund (CD-Fund)",
  tagline:
    "The policy that governs how the church raises, protects, and spends money for capital development.",
  introHeading: "Introduction",
  intro: [
    "The Newlife Seventh-day Adventist Church Development Fund (CD-Fund) is an internal administrative mechanism established by the Newlife SDA Church, located on 5th Ngong Avenue, Nairobi, Kenya. Its primary mandate is to serve as the central vehicle for mobilising, preserving, and deploying financial resources dedicated explicitly to the church's long-term capital development and infrastructure initiatives.",
    "The fund operates under strict compliance with the global SDA Church Manual (2022/2025 edition) and General Conference Working Policy S 85, ensuring that all operations mirror Biblical principles of Christian stewardship, transparency, and accountability. It is not a separate legal entity. All assets, bank accounts, and investments remain under the statutory umbrella and absolute ownership of the Seventh-day Adventist Church.",
  ],
  pillarsHeading: "The core pillars of the fund",
  pillars: [
    {
      number: 1,
      heading: "Strategic purpose and approved uses",
      lead: 'The fund is strictly "ring-fenced", meaning its assets are separated from the church\'s day-to-day operational budgets to protect financial integrity. The money can only be used for:',
      bullets: [
        {
          term: "Infrastructure and construction",
          text: "Building sanctuaries, facilities, and physical support infrastructure.",
        },
        {
          term: "Property acquisition",
          text: "Financing the strategic purchase of land or plots for ministry expansion.",
        },
        {
          term: "Modernisation and renovation",
          text: "Upgrading existing church facilities.",
        },
        {
          term: "Technological advancement",
          text: "Purchasing modern equipment, including high-end multimedia systems (LED walls, professional cameras, audio consoles), digital network security servers, and solar power infrastructure.",
        },
        {
          term: "Inter-generational sustainability",
          text: "Creating long-term financial endowments and reserves.",
        },
      ],
    },
    {
      number: 2,
      heading: "Permitted funding channels",
      lead: "To preserve ethical integrity, the fund strictly blocks speculative or commercial fundraising methods. It draws money exclusively from:",
      bullets: [
        {
          text: "Voluntary member contributions, systematic benevolence, and faith pledges.",
        },
        { text: "Earmarked capital campaigns and special offerings." },
        {
          text: "Surplus operational funds transferred by a vote of the church membership.",
        },
        {
          text: "Regulated, low-risk investment returns and approved grants that carry no conditions conflicting with SDA values.",
        },
        {
          text: 'Secure digital mobilisation, primarily configured through trace-tracked channels like an M-Pesa paybill under the shorthand tag "Newlife SDA CDF".',
        },
      ],
    },
    {
      number: 3,
      heading: "Strict investment policy statement (IPS) guidelines",
      lead: "Any temporary surplus capital waiting to be deployed into construction projects must follow the Prudent Investor Rule. The priority order of the investment strategy is capital preservation first, liquidity second, and optimised returns last.",
      bullets: [
        {
          term: "Permitted investments",
          text: "Sovereign government bonds, Treasury bills (T-bills), fixed-term deposits in reputable tier-one commercial banks, or denominational trust funds.",
        },
        {
          term: "Strict prohibitions",
          text: "Speculative assets like equities and stocks, cryptocurrencies, and derivatives are explicitly banned.",
        },
        {
          term: "Ethical screening",
          text: "Capital can never be exposed to or partnered with industries that contradict the Biblically based health and lifestyle standards of the church, such as alcohol, tobacco, gambling, entertainment, or weapons.",
        },
      ],
    },
    {
      number: 4,
      heading: "The multi-tiered governance structure",
      lead: "The policy maps out a clear separation of powers using five primary tiers to avoid any single point of financial failure:",
      bullets: [
        {
          term: "Newlife Corporate Trust",
          text: "The legal custodian holding the land titles, deeds, and asset protections on behalf of the church.",
        },
        {
          term: "Church business meeting, the highest authority",
          text: "The collective voice of the church membership. It has the ultimate legislative power to ratify the charter, approve major borrowing or asset sales, and adopt annual audited reports.",
        },
        {
          term: "Church board, executive strategy",
          text: "Manages the tactical implementation between business meetings, approves annual fund budgets, and checks risk registers.",
        },
        {
          term: "Finance committee and church treasury, financial custody",
          text: "Holds the money, coordinates banking controls, maintains accounting ledgers, and files monthly statements. They have no project implementation power.",
        },
        {
          term: "Church development committee, project execution",
          text: "Evaluates contractor bids, supervises construction sites, and manages milestones. They have no direct access to cash or accounts.",
        },
      ],
    },
    {
      number: 5,
      heading: "Financial controls and anti-fraud protections",
      lead: "To maximise transparency and satisfy independent review protocols, the policy institutes multiple protective checks:",
      bullets: [
        {
          term: "Segregation of duties",
          text: "No single individual or committee can initiate, authorise, and execute the same payment.",
        },
        {
          term: "Tri-signatory control",
          text: "All financial payments, whether digital or physical, require three authorised sign-offs.",
        },
        {
          term: "Maker-checker workflows",
          text: "Digital cash movements on platform systems must be checked by separated pairs before clearing.",
        },
        {
          term: "Conflict of interest protocol",
          text: "Immediate, mandatory written disclosure of personal or family vendor ties. Any flagged member must physically recuse themselves from the meeting room and cannot vote on related contract awards.",
        },
        {
          term: "Internal audit committee",
          text: "An independent panel of church experts, excluding board or treasury staff, that runs audits of receipt books, bank reconciliation trails, and mobile logs.",
        },
        {
          term: "Record retention",
          text: "All accounting ledgers, vouchers, and contracts must be physically and digitally archived for a statutory period of 7 years.",
        },
      ],
    },
  ],
};
