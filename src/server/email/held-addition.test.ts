import { describe, expect, it } from "vitest";

import { CONTACT } from "@/content/campaign";

import {
  renderAdditionConfirmed,
  renderAdditionHeldNotice,
} from "@/server/email/held-addition";

const base = {
  fullName: "Ruth Achieng Odhiambo",
  reference: "CF26-000424",
  addedMinor: 30_000_000n,
  siteUrl: "https://pledge.example.test",
};

describe("the held addition notice, to the address on record", () => {
  const message = renderAdditionHeldNotice(base);

  it("names the amount and the pledge it is for", () => {
    expect(message.text).toContain("KES 300,000");
    expect(message.text).toContain("CF26-000424");
  });

  it("says nothing changes until the development office confirms it", () => {
    expect(message.text).toContain("Your pledge stays as it is until then");
  });

  it("says who to contact if it was not them, with the office phone from the content file", () => {
    expect(message.text).toContain(
      `If this was not you, contact the development office on ${CONTACT.phoneDisplay}.`,
    );
  });

  it("greets by first name only", () => {
    expect(message.text).toContain("Dear Ruth,");
    expect(message.text).not.toContain("Odhiambo");
  });
});

describe("the confirmation, to the address on record", () => {
  const message = renderAdditionConfirmed({ ...base, totalMinor: 50_000_000n });

  it("gives the addition and the new total", () => {
    expect(message.subject).toBe("Your pledge addition is confirmed");
    expect(message.text).toContain("KES 300,000");
    expect(message.text).toContain("KES 500,000");
    expect(message.text).toContain("CF26-000424");
  });

  it("says a pledge is a promise, not a payment", () => {
    expect(message.text).toContain("not a payment");
  });
});

describe("every message", () => {
  it("has no em dash", () => {
    for (const m of [
      renderAdditionHeldNotice(base),
      renderAdditionConfirmed({ ...base, totalMinor: 50_000_000n }),
    ]) {
      expect(m.html + m.text).not.toContain("\u2014");
    }
  });
});
