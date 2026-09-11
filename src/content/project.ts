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

/**
 * Just enough of the payment details for the giving answers.
 *
 * Declared structurally rather than imported, so this content module stays free
 * of anything that reaches a database. The page resolves the real values and
 * passes them in.
 */
export type FaqPaymentDetails = {
  paybill: string;
  accountName: string;
  bankName: string;
  bankAccount: string;
};

/**
 * The frequently asked questions.
 *
 * A function rather than a constant because two of the giving answers quote the
 * paybill and the bank account, and those can now be changed from the admin
 * settings screen without a deploy. Hard coding them here would mean a treasurer
 * correcting the paybill in one place and leaving a page telling the
 * congregation to send money to the old one, which is the exact failure the
 * settings screen was built to avoid.
 */
export function faqCategories(
  details: FaqPaymentDetails,
): readonly FaqCategory[] {
  return [
    {
      id: "about",
      label: "About the project",
      items: [
        {
          question: "What is the Crystal Fountain Development Project?",
          answer:
            "A proposed multi-use complex at 5th Ngong Avenue, Nairobi, for Newlife SDA Church. It comprises a church sanctuary, a shared basement car park, and a commercial Adventist ministry centre. The sanctuary is the priority.",
        },
        {
          question: "Why does the church need a new building?",
          answer:
            "The current building can no longer comfortably accommodate the congregation, and its carrying capacity has been outstripped. The new development serves today's members and future generations, and positions the church as a centre of influence in Nairobi.",
        },
        {
          question: "How much will the project cost?",
          answer:
            "The church sanctuary, which is the first priority, is estimated at between KES 500 and 600 million to build. This is preliminary and will be refined as the designs are finalised.",
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
            "A pledge is your commitment to contribute a specific amount toward the project. It is a promise, not an immediate payment, and you can fulfil it over three years.",
        },
        {
          question: "How do I make a pledge?",
          answer:
            "Use the pledge form on this website. Enter the amount, your name and phone number, and submit. You will receive a unique reference number and a QR code that opens your pledge again on any phone.",
        },
        {
          /*
           * This answer used to say every pledge was reviewed before it counted,
           * which stopped being true when auto approval was added. Most pledges
           * now count immediately and only larger ones wait, and a page telling
           * somebody their pledge is under review while the total has already
           * moved would be its own small confusion.
           */
          question: "What happens after I pledge?",
          answer:
            "Most pledges are confirmed straight away and count toward the campaign total immediately. A larger pledge is held for the treasurer to confirm first. Either way you get your reference number, a QR code, and payment instructions on the confirmation page.",
        },
        {
          question: "Can I add to my pledge later?",
          answer:
            "Yes. Pledge again using the same phone number and the new amount is added to your existing pledge. You keep the same reference number and the same QR code.",
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
          answer: `By M-Pesa Pay Bill ${details.paybill}, using your pledge reference as the account number, or by bank transfer to ${details.bankName} account ${details.bankAccount} quoting the same reference. Your reference is what lets the treasury match your payment to your pledge.`,
        },
        {
          question: "Can I give without making a pledge?",
          answer: `Yes. Use the same Pay Bill or bank account, with "${details.accountName}" as the account number. A pledge simply helps the project team plan and track progress.`,
        },
        {
          question: "How do I check what I have paid and what is outstanding?",
          answer:
            "Open the redeem page and enter your pledge reference together with the phone number you pledged with. Both are asked for so that nobody else can read your pledge from one of them.",
        },
        {
          question: "Who do I contact for enquiries?",
          answer: `Dr. Steve Mogere, Development Leader, 0722619788, or churchdevelopment@newlifesdanairobi.org.`,
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
            "Yes. A phased construction method is being considered so that worship services and programmes continue with minimal disruption.",
        },
        {
          question: "How will members be kept informed?",
          answer:
            "Through the church website, bulletin, WhatsApp channels, and periodic town hall meetings.",
        },
      ],
    },
  ];
}

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

/**
 * The printed fund summary, offered as a download from /cd-fund. A static file
 * in public/, not an optimised asset, because the point is that a member can
 * save it and pass it on.
 *
 * The hero and the phone menu used to link straight here. They now point at
 * /cd-fund, which carries the whole policy and offers this document at the
 * foot of it, so the PDF is one tap further away and nobody meets the campaign
 * with a download.
 */
export const FUND_SUMMARY = {
  href: "/documents/newlife-cd-fund-summary.pdf",
  label: "Download PDF summary",
} as const;

/**
 * The six step road map printed on the project flyer, and the scan of the
 * flyer itself for anyone who wants the source.
 *
 * `current` is the step the project is on. Everything before it is complete and
 * everything after it is upcoming, so the status of all six is derived from
 * this one number rather than restated per step and left to drift.
 *
 * `icon` is a key, not a component. This file is plain data with no imports,
 * and the component that renders the road map maps these to lucide icons.
 */
export type RoadmapIcon =
  | "vision"
  | "planning"
  | "design"
  | "fundraising"
  | "construction"
  | "dedication";

export const ROADMAP = {
  heading: "Road map to the new sanctuary",
  /** The step the project is on, one based, as printed on the flyer. */
  current: 2,
  /** Read from the flyer, which dates the current step to September 2026. */
  asOf: "September 2026",
  original: {
    href: "/images/roadmap.jpeg",
    label: "View original roadmap",
  },
  steps: [
    { ordinal: "Step one", title: "Vision and model", icon: "vision" },
    { ordinal: "Step two", title: "Planning", icon: "planning" },
    {
      ordinal: "Step three",
      title: "Concept drawing and detailed design",
      icon: "design",
    },
    { ordinal: "Step four", title: "Fundraising", icon: "fundraising" },
    { ordinal: "Step five", title: "Construction", icon: "construction" },
    {
      ordinal: "Step six",
      title: "Dedication, operation and maintenance",
      icon: "dedication",
    },
  ],
} as const satisfies {
  heading: string;
  current: number;
  asOf: string;
  original: { href: string; label: string };
  steps: readonly { ordinal: string; title: string; icon: RoadmapIcon }[];
};
