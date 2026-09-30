/**
 * The printed trifold brochure, as typed data in the repo. There is no CMS, by
 * design, and this file follows the same rule as src/content/project.ts:
 * nothing here is invented.
 *
 * Its own file because of who imports it. The site header imports
 * src/content/project.ts for the nav links, and the bundler ships that whole
 * module with the header on every public page. Kept there, the five pages of
 * alt text and panel copy below rode along on pages that never show them.
 */

/**
 * The five inner pages of the printed trifold. All are 1688x2000, so the
 * intrinsic size is stated once here and every consumer gets it right.
 */
export const BROCHURE_WIDTH = 1688;
export const BROCHURE_HEIGHT = 2000;

/*
 * The alt text says what each page actually contains, not which page it is.
 *
 * These five are the only images on the site carrying information that appears
 * nowhere else in the markup: every figure on them is baked into a JPEG, so a
 * reader on a screen reader who is given "brochure, page 3" has been told the
 * file exists and nothing else. The text below is a summary rather than a
 * transcription, which is the most a single attribute can usefully carry.
 *
 * The home page's detail panel shows the large image with this alt text, and
 * beside it a title, a summary and a short list of what the page covers. Those
 * three are the alt text broken up for reading and claim nothing it does not:
 * a new figure belongs in the alt text first, from the printed page.
 */
export type BrochurePage = {
  readonly src: string;
  readonly alt: string;
  readonly title: string;
  readonly summary: string;
  readonly covers: readonly string[];
};

export const BROCHURE_PAGES: readonly BrochurePage[] = [
  {
    src: "/images/brochure/trifold-page-2.jpg",
    alt: "Crystal Fountain Development Project brochure, page 1: a letter inviting members to join the project and give feedback on the development vision, the use of the whole church property, and the funding of the sanctuary, the ministry facilities and the enterprise building",
    title: "An invitation to join",
    summary:
      "A letter inviting members to join the project and to give their feedback on it.",
    covers: [
      "The development vision",
      "The use of the whole church property",
      "Funding the sanctuary, the ministry facilities and the enterprise building",
    ],
  },
  {
    src: "/images/brochure/trifold-page-3.jpg",
    alt: "Crystal Fountain Development Project brochure, page 2, the current development proposal: a development fund starting at KES 10 million, multipurpose use of the property including a centre of influence, a finance model mixing fundraising and equity, a design model finalised by October 2025, and construction beginning in 2026",
    title: "The development proposal",
    summary:
      "The current development proposal: how the fund starts, how the property is used, and how the work is paid for and scheduled.",
    covers: [
      "A development fund starting at KES 10 million",
      "Multipurpose use of the property, including a centre of influence",
      "A finance model mixing fundraising and equity",
      "A design model finalised by October 2025",
      "Construction beginning in 2026",
    ],
  },
  {
    src: "/images/brochure/trifold-page-4.jpg",
    alt: "Crystal Fountain Development Project brochure, page 3, the current sanctuary proposal: a main auditorium seating 3,000 to 5,000, three smaller auditoriums seating 150 to 400, three basement parking levels for up to 700 vehicles, ground level green space with a library, church history museum, offices and classrooms, and construction estimated between KES 500 and 600 million",
    title: "The sanctuary proposal",
    summary:
      "The current sanctuary proposal: the auditoriums, the parking beneath them and the space at ground level.",
    covers: [
      "A main auditorium seating 3,000 to 5,000",
      "Three smaller auditoriums seating 150 to 400",
      "Three basement parking levels for up to 700 vehicles",
      "Ground level green space with a library, church history museum, offices and classrooms",
      "Construction estimated between KES 500 and 600 million",
    ],
  },
  {
    src: "/images/brochure/trifold-page-5.jpg",
    alt: "Crystal Fountain Development Project brochure, page 4, mixed use development of the church property: a prime site with a plot ratio of about 300, and three funding options, fundraising, debt financing and equity partnership, of which the development team proposes a mix of fundraising and equity",
    title: "Mixed use of the property",
    summary:
      "Mixed use development of the church property, and the options for funding it.",
    covers: [
      "A prime site with a plot ratio of about 300",
      "Three funding options: fundraising, debt financing and equity partnership",
      "The development team proposes a mix of fundraising and equity",
    ],
  },
  {
    src: "/images/brochure/trifold-page-6.jpg",
    alt: "Crystal Fountain Development Project brochure, page 5, the road map to the new sanctuary in six steps: vision and model, planning, concept drawing and detailed design, fundraising, construction, and dedication, operation and maintenance",
    title: "The road map in six steps",
    summary: "The road map to the new sanctuary, in six steps.",
    covers: [
      "Vision and model",
      "Planning",
      "Concept drawing and detailed design",
      "Fundraising",
      "Construction",
      "Dedication, operation and maintenance",
    ],
  },
];
