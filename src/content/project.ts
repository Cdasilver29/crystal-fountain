/**
 * Project content as typed data in the repo. There is no CMS, by design.
 *
 * Everything here comes from the church's published pages and the printed
 * trifold brochure. Nothing is invented. Em dashes in the source copy are
 * rendered as a colon or a comma, because CLAUDE.md rules them out.
 *
 * Payment figures and contact details are NOT duplicated here. They live in
 * src/content/campaign.ts and are read from there.
 */

/** The project launch video. Loaded only when a visitor clicks it. */
export const LAUNCH_VIDEO = {
  id: "k6VRsf3ZH7w",
  title: "Crystal Fountain Development Project launch",
} as const;

/** Read at the unveiling of the vision. */
export const SCRIPTURE_HAGGAI = {
  text: "The glory of this latter house shall be greater than of the former, and in this place will I give peace, saith the Lord of hosts.",
  reference: "Haggai 2:9",
} as const;

export const NAV_LINKS: readonly { href: string; label: string }[] = [
  { href: "/", label: "Home" },
  { href: "/vision", label: "Vision" },
  { href: "/faq", label: "FAQ" },
  { href: "/progress", label: "Progress" },
  { href: "/updates", label: "Updates" },
];

/**
 * The church's own accounts, taken from the footer of newlifesdanairobi.org.
 * Two of them carry a trailing encoded space in the source markup, which is
 * stripped here rather than copied.
 */
export const SOCIAL_LINKS: readonly { label: string; href: string }[] = [
  { label: "Facebook", href: "https://www.facebook.com/newlifesdanairobi.org" },
  { label: "Twitter", href: "https://twitter.com/NewlifechurchKE" },
  {
    label: "Instagram",
    href: "https://www.instagram.com/newlifesdachurchnairobi/",
  },
  {
    label: "YouTube",
    href: "https://www.youtube.com/c/NewlifeSDAChurchNairobi/videos",
  },
];

/** The three steps printed on the campaign flyer, in order. */
export const PLEDGE_STEPS: readonly { step: string; label: string }[] = [
  { step: "1", label: "Pray" },
  { step: "2", label: "Pledge" },
  { step: "3", label: "Redeem" },
];

export type CommitmentTier = {
  families: number;
  /** Whole shillings. A guide figure for display, never a money total. */
  pledgePerFamilyKes: number;
  /**
   * The rows the campaign material leans on, highlighted so a household has
   * somewhere to place itself rather than reading nine equal options.
   */
  sweetSpot?: boolean;
};

/**
 * The targeted commitment guide from the church's campaign material.
 *
 * Each row is one way the congregation reaches the target: this many families
 * pledging this much each over three years. The per family figures are the
 * church's published, rounded numbers, so a row multiplied out lands near the
 * target rather than exactly on it. They are guide figures for a member reading
 * a table, not amounts anything is calculated from.
 *
 * The target itself is not stated here. It is read from the database and passed
 * in, per CLAUDE.md.
 */
export const COMMITMENT_TIERS: readonly CommitmentTier[] = [
  { families: 55, pledgePerFamilyKes: 10_000_000 },
  { families: 100, pledgePerFamilyKes: 5_500_000 },
  { families: 150, pledgePerFamilyKes: 3_670_000 },
  { families: 200, pledgePerFamilyKes: 2_700_000, sweetSpot: true },
  { families: 250, pledgePerFamilyKes: 2_200_000, sweetSpot: true },
  { families: 300, pledgePerFamilyKes: 1_800_000 },
  { families: 350, pledgePerFamilyKes: 1_600_000 },
  { families: 450, pledgePerFamilyKes: 1_300_000 },
  { families: 500, pledgePerFamilyKes: 1_000_000 },
];

/** Headings for the commitment section. A colon stands in for the em dash. */
export const COMMITMENT_COPY = {
  heading: "Church Development Fund: targeted commitment",
  subheading: "Over a 3-year period",
  cta: "Find your family's place in the vision.",
  ctaLink: "Make a pledge",
} as const;

export type Milestone = {
  when: string;
  what: string;
  /** The milestone the campaign is on now. Exactly one is true. */
  current?: boolean;
};

export const TIMELINE: readonly Milestone[] = [
  { when: "June 2025", what: "Vision unveiled" },
  { when: "2025", what: "Concept proposals and member consultation" },
  {
    when: "September 2026",
    what: "Launch of Church Development Fund",
    current: true,
  },
  { when: "Next", what: "Design finalisation and approvals" },
  { when: "Future", what: "Construction begins, phased to funding" },
];

/**
 * The five inner pages of the printed trifold. All are 1688x2000, so the
 * intrinsic size is stated once here and every consumer gets it right.
 */
export const BROCHURE_WIDTH = 1688;
export const BROCHURE_HEIGHT = 2000;

export const BROCHURE_PAGES: readonly { src: string; alt: string }[] = [
  {
    src: "/images/brochure/trifold-page-2.jpg",
    alt: "Crystal Fountain Development Project brochure, page 1",
  },
  {
    src: "/images/brochure/trifold-page-3.jpg",
    alt: "Crystal Fountain Development Project brochure, page 2",
  },
  {
    src: "/images/brochure/trifold-page-4.jpg",
    alt: "Crystal Fountain Development Project brochure, page 3",
  },
  {
    src: "/images/brochure/trifold-page-5.jpg",
    alt: "Crystal Fountain Development Project brochure, page 4",
  },
  {
    src: "/images/brochure/trifold-page-6.jpg",
    alt: "Crystal Fountain Development Project brochure, page 5",
  },
];

/** The short vision statement used on the home page. */
export const VISION_SUMMARY =
  "The Crystal Fountain Development gives our church a permanent, larger home: a sanctuary built for the size and future of this congregation, while creating a mixed-use tower alongside it that generates income to sustain the ministry for years to come.";

export type VisionSection = {
  id: string;
  heading: string;
  paragraphs: readonly string[];
  /** Index into BROCHURE_PAGES, when a brochure page illustrates the section. */
  illustration?: number;
};

export const VISION_SECTIONS: readonly VisionSection[] = [
  {
    id: "sanctuary",
    heading: "The sanctuary",
    paragraphs: [
      "At the centre of the development is a main auditorium seating 3,000 to 5,000 worshippers. The current building can no longer comfortably hold the congregation, and a sanctuary of this size is sized not for today's attendance but for the church this congregation is becoming.",
      "The design intent is a room built for worship first: clear sightlines, sound that carries to the back row, and a platform that works for a Sabbath service, a graduation, and a full choir alike. Smaller auditoriums alongside it give departments and youth ministries rooms of their own rather than a shared hall booked out every week.",
    ],
    illustration: 0,
  },
  {
    id: "facilities",
    heading: "The facilities",
    paragraphs: [
      "Basement parking for up to 700 vehicles runs across three levels, taking Sabbath parking off 5th Ngong Avenue and the surrounding streets.",
      "Above ground the development adds classrooms for Sabbath School and the church school, a library, a church history museum recording the story of Adventism in Nairobi, offices for pastoral and administrative staff, and landscaped grounds that give the site room to breathe.",
    ],
    illustration: 1,
  },
  {
    id: "tower",
    heading: "The commercial tower",
    paragraphs: [
      "A mixed-use commercial tower stands alongside the sanctuary. It is not an afterthought: it is how the development pays for itself over time.",
      "Rental income from the tower is intended to sustain the ministry and the upkeep of the building for years to come, so that the congregation is not asked to fund maintenance out of offerings in perpetuity. A building that earns is a building that lasts.",
    ],
    illustration: 2,
  },
  {
    id: "site",
    heading: "The site",
    paragraphs: [
      "The development is built on the church's existing property at 5th Ngong Avenue, Nairobi. No land needs to be bought, and the congregation stays where it has always been.",
      "Construction is phased to funding availability, and building approvals are required from Nairobi City County and the National Construction Authority before work starts. Throughout construction the church will continue to operate, with phased arrangements so that worship services and programmes carry on with minimal disruption.",
    ],
    illustration: 3,
  },
];

export type FaqItem = { question: string; answer: string };

export type FaqCategory = {
  id: string;
  label: string;
  items: readonly FaqItem[];
};

export const FAQ_CATEGORIES: readonly FaqCategory[] = [
  {
    id: "about",
    label: "About the project",
    items: [
      {
        question: "What is the Crystal Fountain Development Project?",
        answer:
          "A proposed multi-storey church complex for Newlife SDA Church, Nairobi. It includes a main auditorium seating 3,000 to 5,000, smaller auditoriums, basement parking for 700 vehicles, a library, a church history museum, offices, classrooms, and landscaped grounds.",
      },
      {
        question: "Why does the church need a new building?",
        answer:
          "The current building can no longer comfortably accommodate the congregation. The new development serves today's members and future generations, and positions the church as a centre of influence in Nairobi.",
      },
      {
        question: "How much will the project cost?",
        answer:
          "The estimated construction cost is KES 500 to 600 million. This is preliminary and will be refined as designs are finalised.",
      },
      {
        question: "Who oversees the project?",
        answer:
          "The Development Committee of Newlife Seventh-day Adventist Church, working with other departments and church offices. Professional architects, engineers, and project managers will execute the work.",
      },
    ],
  },
  {
    id: "pledging",
    label: "Pledging",
    items: [
      {
        question: "What is a pledge?",
        answer:
          "A pledge is your commitment to contribute a specific amount toward the project. It is a promise, not an immediate payment. You can fulfil your pledge over time.",
      },
      {
        question: "How do I make a pledge?",
        answer:
          "Use the pledge form on this website. Enter the amount, your name and phone number, and submit. You will receive a unique reference number and QR code.",
      },
      {
        question: "What happens after I pledge?",
        answer:
          "Your pledge is recorded and reviewed. Once confirmed, it counts toward the campaign total. You will see payment instructions on the confirmation page.",
      },
      {
        question: "Can I change or cancel my pledge?",
        answer:
          "Contact the church development office. Pledges can be adjusted as circumstances require.",
      },
    ],
  },
  {
    id: "giving",
    label: "Giving",
    items: [
      {
        question: "How do I pay toward my pledge?",
        answer:
          "Via M-Pesa Paybill 861200 (Account: Church Development Fund) or bank transfer to Standard Chartered Bank account 0102022990600. Quote your pledge reference when paying.",
      },
      {
        question: "Can I give without making a pledge?",
        answer:
          "Yes. Use the same M-Pesa paybill or bank account. A pledge simply helps the project team plan and track progress.",
      },
      {
        question: "Who do I contact for enquiries?",
        answer: "Dr. Steve Mogere, Development Leader, 0722619788.",
      },
    ],
  },
  {
    id: "construction",
    label: "Construction",
    items: [
      {
        question: "When will construction begin?",
        answer:
          "Subject to completion of design, approvals, and sufficient funding. The timeline will be communicated through official channels.",
      },
      {
        question: "Will the church still operate during construction?",
        answer:
          "Yes. Construction will be phased so worship services and programs continue with minimal disruption.",
      },
      {
        question: "How will members be kept informed?",
        answer:
          "Through the church website, bulletin, WhatsApp channels, and periodic town hall meetings.",
      },
    ],
  },
];

/** Governance and transparency copy, used on the home page and /vision. */
export const ACCOUNTABILITY = {
  oversight:
    "The Crystal Fountain Development Project is overseen by the Development Committee of Newlife Seventh-day Adventist Church working with other departments and church offices. Professional architects, engineers, and project managers will be engaged to execute the work.",
  updates:
    "All contributions are acknowledged and accounted for. Regular updates on funding, design, and construction progress will be shared openly with the congregation through the church website, bulletin, and official communication channels.",
} as const;

/** Placeholder for /updates until there is real news to post. */
export const UPDATES_PLACEHOLDER =
  "Updates on the Crystal Fountain Development Project will be posted here as the project progresses. Check back regularly or follow the church's official channels for the latest news.";
