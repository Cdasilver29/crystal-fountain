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
  { href: "/vision", label: "Vision" },
  { href: "/faq", label: "FAQ" },
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

/**
 * The four key numbers. "Vision unveiled" is dated 2025, when the vision was
 * actually unveiled. The covenant launch in September 2026 is a separate
 * milestone and appears on the timeline, not here.
 */
export const KEY_NUMBERS: readonly { value: string; label: string }[] = [
  { value: "3,000-5,000", label: "Main auditorium seats" },
  { value: "700", label: "Parking spaces" },
  { value: "KES 550M", label: "Campaign target" },
  { value: "2025", label: "Vision unveiled" },
];

export type Milestone = {
  when: string;
  what: string;
  /** The milestone the campaign is on now. Exactly one is true. */
  current?: boolean;
};

export const TIMELINE: readonly Milestone[] = [
  { when: "June 2025", what: "Vision unveiled" },
  { when: "5 July 2025", what: "Church Development Fund launched" },
  { when: "2025", what: "Concept proposals and member consultation" },
  {
    when: "September 2026",
    what: '"This is My Pledge" covenant launch',
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

export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    question: "What is the Crystal Fountain Development Project?",
    answer:
      "A proposed multi-storey church complex for Newlife SDA Church, Nairobi. It will include a main auditorium seating 3,000 to 5,000 people, additional smaller auditoriums, basement parking for up to 700 vehicles, a library, a church history museum, offices, classrooms, and landscaped grounds, all on the church's current site along Ngong Road.",
  },
  {
    question: "Why does the church need a new building?",
    answer:
      "The current building can no longer comfortably accommodate the congregation, which has grown significantly. The new development is designed to serve not just today's members but future generations, and to position the church as a centre of influence in Nairobi.",
  },
  {
    question: "How much will the project cost?",
    answer:
      "The estimated construction cost is KES 500 to 600 million. This is a preliminary figure that will be refined as architectural and engineering designs are finalised.",
  },
  {
    question: "How is the project being funded?",
    answer:
      "Through member contributions, designated building fund offerings, fundraising initiatives, and potential grants or partnerships. Every member is encouraged to contribute prayerfully.",
  },
  {
    question: "How can I contribute?",
    answer:
      "You can make a pledge through this platform, or give directly via M-Pesa Paybill 861200 (Account: Church Development Fund) or bank transfer to Standard Chartered Bank account 0102022990600.",
  },
  {
    question: "What is a pledge?",
    answer:
      "A pledge is your commitment to contribute a specific amount toward the project. It is a promise, not an immediate payment. You can fulfil your pledge over time.",
  },
  {
    question: "Who oversees the project?",
    answer:
      "The Building Committee, working under the church board and in consultation with the Kenya-Lake Union Conference. Professional architects, engineers, and project managers will execute the work.",
  },
  {
    question: "Will the church still operate during construction?",
    answer:
      "Yes. Construction will be phased to ensure worship services and programs continue with minimal disruption.",
  },
  {
    question: "When is construction expected to begin?",
    answer:
      "Subject to completion of design, approvals, and sufficient funding. The timeline will be communicated through official church channels.",
  },
  {
    question: "How will members be kept informed?",
    answer:
      "Through the church website, bulletin, WhatsApp channels, and periodic town hall meetings. The Building Committee is committed to transparency at every stage.",
  },
];

/** Governance and transparency copy, used on the home page and /vision. */
export const ACCOUNTABILITY = {
  oversight:
    "The Crystal Fountain Development Project is overseen by the Building Committee, working under the direction of the church board and in consultation with the Kenya-Lake Union Conference of Seventh-day Adventists. Professional architects, engineers, and project managers will be engaged to execute the work.",
  updates:
    "All contributions are acknowledged and accounted for. Regular updates on funding, design, and construction progress will be shared openly with the congregation through the church website, bulletin, and official communication channels.",
} as const;

/** Placeholder for /updates until there is real news to post. */
export const UPDATES_PLACEHOLDER =
  "Updates on the Crystal Fountain Development Project will be posted here as the project progresses. Check back regularly or follow the church's official channels for the latest news.";
