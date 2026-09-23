import { describe, expect, it } from "vitest";

import { nameNeedsReview, type NameReviewInput } from "@/server/display-name-review";

/**
 * Every stored name below is from the live campaign, as typed. The brief named
 * the rendered failures ("The F.", "Family M.", "Shimrone F.", "Mr & Mrs A.",
 * "SAMUEL N.", "RODNEY O."), and these are the stored names that produce them.
 */

function check(storedName: string, overrides: Partial<NameReviewInput> = {}) {
  return nameNeedsReview({
    storedName,
    displayConsent: true,
    isOrganisation: false,
    publicDisplayName: null,
    ...overrides,
  });
}

describe("nameNeedsReview", () => {
  it.each([
    ["The Nzioki's Family", "title or word treated as a name"],
    ["Family of Elder Ongala Maurice", "title or word treated as a name"],
    ["Mr &Mrs Abuga.", "title or word treated as a name"],
    ["Tom Getange & Family", "title or word treated as a name"],
    ["Mangera sam&family", "title or word treated as a name"],
    ["SAMUEL NGOA", "all capitals"],
    ["RODNEY OMARI", "all capitals"],
    ["FREDRICK OMONDI", "all capitals"],
    ["Shimrone Munga Family", "surname replaced by the word Family"],
    ["Mr. Shimron Adede & Sharon's Family", "surname replaced by the word Family"],
    ["Dr.PAUL & CHARYL OTUNG’S FAMILY", "surname replaced by the word Family"],
    ["Mr/so Maxuel Omondi", "contains a slash"],
    ["Antony", "no surname"],
    ["Cheptanui", "no surname"],
  ])("flags %s as %s", (stored, reason) => {
    expect(check(stored)).toEqual({ reason });
  });

  it.each([
    "Grace Wanjiru",
    "Steve Mogere",
    "Mr. Steve Mogere",
    "Dr Justine Nyarige",
    "Jared okoth",
    "Symon and Scoller Otieno",
    "Melanie& Vincent",
    "Beryl Achieng Okoth",
  ])("does not flag %s", (stored) => {
    expect(check(stored)).toBeNull();
  });

  it("does not flag a typo shaped like a real name, which is left to a person", () => {
    expect(check("Petet Otieno")).toBeNull();
  });

  it("skips a pledger with a hand set public name, because a person has read it", () => {
    expect(check("The Nzioki's Family", { publicDisplayName: "The Nzioki family" })).toBeNull();
  });

  it("still checks a pledger whose hand set name is blank, since blank means automatic", () => {
    expect(check("SAMUEL NGOA", { publicDisplayName: "  " })).toEqual({
      reason: "all capitals",
    });
  });

  it("skips an organisation, which a treasurer has already reviewed", () => {
    expect(check("AMM/AMO  Seed Fund", { isOrganisation: true })).toBeNull();
    expect(check("AMM/AMO  Seed Fund")).toEqual({ reason: "contains a slash" });
  });

  it("skips a pledger who has not consented to being shown", () => {
    expect(check("SAMUEL NGOA", { displayConsent: false })).toBeNull();
  });

  it("does not read an F initial as Family when the word is not there", () => {
    expect(check("Grace Fundi")).toBeNull();
  });
});
