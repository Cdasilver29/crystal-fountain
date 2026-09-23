import { describe, expect, it } from "vitest";

import { displayName } from "@/server/display-name";

/**
 * The cases below are the ones named in the brief, plus the two real display
 * names from the campaign that sent us here: "Mr. Steve Mogere", which was
 * rendering as "Mr. S.", and the joint pledge that was rendering as
 * "Melanie& V.".
 *
 * The privacy block at the end is the part that matters most. Everything else
 * is presentation, but a surname reaching a public page is a consent failure,
 * so it is asserted directly rather than inferred from the formatting cases.
 */

describe("displayName", () => {
  it("renders a plain two part name as a first name and an initial", () => {
    expect(displayName("Grace Kamau")).toBe("Grace K.");
  });

  it("strips a title before picking the first name", () => {
    expect(displayName("Mr. Steve Mogere")).toBe("Steve M.");
  });

  it("takes the initial from the last word, so a middle name is not a surname", () => {
    expect(displayName("Grace Wanjiru Kamau")).toBe("Grace K.");
  });

  it("keeps both given names in a joint pledge joined by an ampersand", () => {
    expect(displayName("Melanie & Victor Otieno")).toBe("Melanie & Victor O.");
  });

  it("handles a joint pledge joined by the word and", () => {
    expect(displayName("Grace and Peter Otieno")).toBe("Grace & Peter O.");
  });

  it("renders a single word name alone, with no initial", () => {
    expect(displayName("Antony")).toBe("Antony");
  });

  it("trims and collapses repeated whitespace", () => {
    expect(displayName("   Grace    Wanjiru   Kamau  ")).toBe("Grace K.");
  });

  it("upper cases a lowercase name and its initial", () => {
    expect(displayName("grace kamau")).toBe("Grace K.");
  });

  it("falls back to the original when the name is only a title", () => {
    expect(displayName("Mr.")).toBe("Mr.");
    expect(displayName("Pastor")).toBe("Pastor");
  });

  describe("the joint pledge that was rendering as Melanie& V.", () => {
    it("spaces the ampersand even when the stored name does not", () => {
      expect(displayName("Melanie& Victor Otieno")).toBe("Melanie & Victor O.");
    });

    it("never renders an ampersand where an initial belongs", () => {
      expect(displayName("Melanie & Victor")).toBe("Melanie & Victor");
      expect(displayName("Melanie &")).toBe("Melanie");
    });

    it("does not publish a surname from the left of the joiner", () => {
      expect(displayName("Melanie Wanjiru & Victor Otieno")).toBe(
        "Melanie & Victor O.",
      );
    });
  });

  describe("titles", () => {
    it.each([
      ["Mr Steve Mogere", "Steve M."],
      ["Mrs Grace Kamau", "Grace K."],
      ["Ms Grace Kamau", "Grace K."],
      ["Miss Grace Kamau", "Grace K."],
      ["Dr. Grace Kamau", "Grace K."],
      ["Prof Grace Kamau", "Grace K."],
      ["Pr. Grace Kamau", "Grace K."],
      ["Pastor Grace Kamau", "Grace K."],
      ["Elder Grace Kamau", "Grace K."],
      ["Eng. Grace Kamau", "Grace K."],
      ["Rev Grace Kamau", "Grace K."],
      ["Sr Grace Kamau", "Grace K."],
      ["Br. Grace Kamau", "Grace K."],
      ["PASTOR grace kamau", "Grace K."],
      ["mr. steve mogere", "Steve M."],
    ])("strips %s", (input, expected) => {
      expect(displayName(input)).toBe(expected);
    });
  });

  describe("the initial is always one upper case letter and a full stop", () => {
    it.each([
      ["Grace kamau", "Grace K."],
      ["Grace Kamau,", "Grace K."],
      ["Grace (Kamau)", "Grace K."],
      ["Grace K.", "Grace K."],
    ])("%s", (input, expected) => {
      expect(displayName(input)).toBe(expected);
    });

    it("gives no initial when the last word has no letter in it", () => {
      expect(displayName("Grace -")).toBe("Grace");
    });
  });

  describe("privacy", () => {
    const SURNAMES = ["Kamau", "Otieno", "Mogere", "Wanjiru", "Njeri"];

    it.each([
      "Grace Kamau",
      "Grace Wanjiru Kamau",
      "Mr. Steve Mogere",
      "Melanie & Victor Otieno",
      "Melanie Wanjiru & Victor Otieno",
      "Mary Njeri Kamau",
      "grace   njeri    otieno",
    ])("no surname survives %s", (input) => {
      const rendered = displayName(input);
      for (const surname of SURNAMES) {
        expect(rendered).not.toContain(surname);
      }
    });

    it("never renders more than one letter of a surname", () => {
      // Whatever is left after the given names is at most "X." each time.
      for (const input of [
        "Grace Kamau",
        "Grace Wanjiru Kamau",
        "Melanie & Victor Otieno",
        "Mr. Steve Mogere",
      ]) {
        const tail = displayName(input).split(" ").at(-1) ?? "";
        expect(tail).toMatch(/^\p{Lu}\.$/u);
      }
    });
  });

  /*
   * Every one of these is a real stored display name from the campaign, found
   * by rendering all 47 consented names and reading the output. They are the
   * reason the function is shaped the way it is.
   */
  describe("names actually in the database", () => {
    it.each([
      // The title is written onto the name, so it is not a word of its own.
      ["Dr.PAUL & CHARYL OTUNG'S FAMILY", "PAUL & CHARYL F."],
      // The only real word is the surname both of them share.
      ["Mr &Mrs Abuga.", "Mr & Mrs A."],
      // A mistyped "Mr/Mrs", which still has to come off.
      ["Mr/so Maxuel Omondi", "Maxuel O."],
      // An organisation. "AMM" is not a title, so the slashed token is kept
      // whole, and capitals are left exactly as the pledger typed them.
      ["AMM/AMO  Seed Fund", "AMM/AMO F."],
      ["Mr. Shimron Adede & Sharon's Family", "Shimron & Sharon's F."],
      ["Symon and Scoller Otieno", "Symon & Scoller O."],
      ["Melanie& Vincent", "Melanie & Vincent"],
      ["Tom Getange & Family", "Tom & Family"],
      ["Mangera sam&family", "Mangera & Family"],
      ["Shimrone Munga Family", "Shimrone F."],
      ["The Nzioki's Family", "The F."],
      ["Family of Elder Ongala Maurice", "Family M."],
      ["wycliffe ndiema", "Wycliffe N."],
    ])("%s", (stored, expected) => {
      expect(displayName(stored)).toBe(expected);
    });

    it("publishes no stored surname from any of them", () => {
      const stored = [
        "Dr.PAUL & CHARYL OTUNG'S FAMILY",
        "Mr &Mrs Abuga.",
        "Mr/so Maxuel Omondi",
        "Mr. Shimron Adede & Sharon's Family",
        "Symon and Scoller Otieno",
        "Tom Getange & Family",
        "Shimrone Munga Family",
        "The Nzioki's Family",
      ];
      const surnames = [
        "OTUNG",
        "Abuga",
        "Omondi",
        "Adede",
        "Otieno",
        "Getange",
        "Munga",
        "Nzioki",
      ];

      for (const name of stored) {
        const rendered = displayName(name);
        for (const surname of surnames) {
          expect(rendered).not.toContain(surname);
        }
      }
    });
  });

  /*
   * The flag the treasurer sets on the pledge screen. Both names below are real
   * organisations in the campaign, and both read oddly without it.
   */
  describe("an organisation", () => {
    it.each([
      ["AMM/AMO  Seed Fund", "AMM/AMO Seed Fund"],
      ["Adventist Womens Ministry", "Adventist Womens Ministry"],
      ["Newlife Sanctuary Choir", "Newlife Sanctuary Choir"],
      ["The Nzioki's Family", "The Nzioki's Family"],
    ])("%s renders in full", (stored, expected) => {
      expect(displayName(stored, { isOrganisation: true })).toBe(expected);
    });

    it("still collapses whitespace and unsticks a glued title", () => {
      expect(displayName("  Dr.PAUL   Memorial   Fund  ", { isOrganisation: true }))
        .toBe("Dr. PAUL Memorial Fund");
    });

    it("changes nothing when the flag is false or absent", () => {
      expect(displayName("Grace Kamau", { isOrganisation: false })).toBe("Grace K.");
      expect(displayName("Grace Kamau", {})).toBe("Grace K.");
      expect(displayName("Grace Kamau")).toBe("Grace K.");
    });

    it("an empty name is still empty, flag or no flag", () => {
      expect(displayName("", { isOrganisation: true })).toBe("");
      expect(displayName("   ", { isOrganisation: true })).toBe("");
    });
  });

  describe("degenerate input", () => {
    it.each([
      ["", ""],
      ["   ", ""],
      ["&", "&"],
      ["Grace", "Grace"],
    ])("%s stays sane", (input, expected) => {
      expect(displayName(input)).toBe(expected);
    });
  });
});

/*
 * The hand set name. It wins over the derivation and over the organisation
 * flag, and it is published exactly as the treasurer typed it.
 */
describe("displayName with an override", () => {
  it("returns the override verbatim instead of the derived name", () => {
    expect(displayName("Petet Otieno", { override: "Peter O." })).toBe("Peter O.");
  });

  it("wins over the organisation flag", () => {
    expect(
      displayName("AMM/AMO  Seed Fund", {
        isOrganisation: true,
        override: "AMM Seed Fund",
      }),
    ).toBe("AMM Seed Fund");
  });

  it("is not tidied, capitalised or cut down", () => {
    expect(displayName("The Nzioki's Family", { override: "the Nzioki family" })).toBe(
      "the Nzioki family",
    );
  });

  it("falls back to the derived name when null or blank", () => {
    expect(displayName("SAMUEL NJOROGE", { override: null })).toBe("SAMUEL N.");
    expect(displayName("Grace Kamau", { override: "   " })).toBe("Grace K.");
  });
});
