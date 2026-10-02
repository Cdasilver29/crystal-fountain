import { describe, expect, it } from "vitest";

import { changeRequestInput } from "./change-requests";
import { cleanName, hasStrippableCharacters } from "./names";
import {
  adminCreatePledgeInput,
  createPledgeInput,
  setPublicDisplayNameInput,
} from "./pledges";

/** Built from code points so this file never carries an invisible character. */
const c = (...points: number[]) => String.fromCodePoint(...points);

const RLO = c(0x202e);
const LRI = c(0x2066);
const PDI = c(0x2069);
const ZWSP = c(0x200b);
const ZWJ = c(0x200d);
const BOM = c(0xfeff);
const LRM = c(0x200e);
const RLM = c(0x200f);
const ARABIC = c(0x0641, 0x0627, 0x0637, 0x0645, 0x0629); // Fatima
const HEBREW = c(0x05e9, 0x05e8, 0x05d4); // Sarah

describe("cleanName", () => {
  it("leaves an ordinary name alone", () => {
    expect(cleanName("Grace Wanjiku Kamau")).toBe("Grace Wanjiku Kamau");
    expect(cleanName("Mary-Anne O'Brien")).toBe("Mary-Anne O'Brien");
  });

  it("composes to NFC", () => {
    const decomposed = `Rene${c(0x0301)}e`;
    expect(cleanName(decomposed)).toBe(`Ren${c(0x00e9)}e`);
    expect(cleanName(decomposed)).toHaveLength(5);
  });

  it("strips control characters, and turns typed line breaks into spaces", () => {
    expect(cleanName(`Jane${c(0x0007)}Doe`)).toBe("JaneDoe");
    expect(cleanName(`Jane${c(0x0000)} Doe${c(0x007f)}`)).toBe("Jane Doe");
    expect(cleanName(`Jane${c(0x0085)}Doe`)).toBe("Jane Doe");
    expect(cleanName("Jane\nDoe\t\r\nSmith")).toBe("Jane Doe Smith");
  });

  it("strips zero width characters", () => {
    expect(cleanName(`Ja${ZWSP}ne D${ZWJ}oe${BOM}`)).toBe("Jane Doe");
    expect(cleanName(`Jane${c(0x2060)}Doe`)).toBe("JaneDoe");
  });

  it("strips the direction controls, every one of them", () => {
    for (let cp = 0x202a; cp <= 0x202e; cp++) {
      expect(cleanName(`Jane${c(cp)} Doe`)).toBe("Jane Doe");
    }
    for (let cp = 0x2066; cp <= 0x2069; cp++) {
      expect(cleanName(`Jane${c(cp)} Doe`)).toBe("Jane Doe");
    }
    // The classic reversal: "Jane " then an override that flips what follows.
    expect(cleanName(`Jane ${RLO}eoD`)).toBe("Jane eoD");
    expect(cleanName(`${LRI}Jane${PDI}`)).toBe("Jane");
  });

  it("never strips right to left letters, or the plain direction marks", () => {
    expect(cleanName(`${ARABIC} Ali`)).toBe(`${ARABIC} Ali`);
    expect(cleanName(HEBREW)).toBe(HEBREW);
    expect(cleanName(`${ARABIC}${RLO} ${HEBREW}`)).toBe(`${ARABIC} ${HEBREW}`);
    expect(cleanName(`Jane${LRM}${RLM}`)).toBe(`Jane${LRM}${RLM}`);
  });

  it("collapses whitespace, including the wide and non breaking kinds", () => {
    expect(cleanName(`  Jane ${c(0x00a0)}${c(0x3000)}  Doe  `)).toBe("Jane Doe");
    // What hid between two spaces is gone first, so they collapse to one.
    expect(cleanName(`Jane ${ZWSP} Doe`)).toBe("Jane Doe");
  });

  it("says whether a value carries anything it would strip", () => {
    expect(hasStrippableCharacters("Grace")).toBe(false);
    expect(hasStrippableCharacters(`${ARABIC}${LRM}`)).toBe(false);
    expect(hasStrippableCharacters(`Grace${RLO}`)).toBe(true);
    expect(hasStrippableCharacters(`Gr${ZWSP}ace`)).toBe(true);
  });
});

describe("every contract that takes a name cleans it", () => {
  const pledge = {
    phone: "0712345678",
    intent: "one_off",
    amountKes: 1000,
    recordConsent: true,
    contactConsent: false,
    displayConsent: true,
  };

  it("the pledge form", () => {
    const parsed = createPledgeInput.parse({ ...pledge, fullName: ` Jane${RLO}  Doe${ZWSP} ` });
    expect(parsed.fullName).toBe("Jane Doe");
  });

  it("refuses a name that is only invisible characters", () => {
    const parsed = createPledgeInput.safeParse({ ...pledge, fullName: `${ZWSP}${RLO}${BOM}x` });
    expect(parsed.success).toBe(false);
  });

  it("the treasurer's entry form", () => {
    const parsed = adminCreatePledgeInput.parse({
      phone: "0712345678",
      amountKes: 1000,
      fullName: `Jane${c(0x2067)} Doe`,
    });
    expect(parsed.fullName).toBe("Jane Doe");
  });

  it("the correct name request", () => {
    const parsed = changeRequestInput.parse({
      kind: "correct_name",
      reference: "CF26-000124",
      contactPhoneE164: "0712345678",
      reason: "My name was misspelled on the list.",
      requestedName: `Jane${ZWJ} Doe${RLO}`,
    });
    expect(parsed.kind === "correct_name" && parsed.requestedName).toBe("Jane Doe");
  });

  it("the public display name override, still nullable", () => {
    expect(setPublicDisplayNameInput.parse({ publicDisplayName: `${LRI}Jane D.${PDI}` }))
      .toEqual({ publicDisplayName: "Jane D." });
    expect(setPublicDisplayNameInput.parse({ publicDisplayName: null }))
      .toEqual({ publicDisplayName: null });
    expect(setPublicDisplayNameInput.safeParse({ publicDisplayName: ZWSP }).success)
      .toBe(false);
  });

  it("applies the length limits after cleaning", () => {
    const long = `${"A".repeat(80)}${ZWSP.repeat(20)}`;
    expect(setPublicDisplayNameInput.parse({ publicDisplayName: long }).publicDisplayName)
      .toHaveLength(80);
  });
});
