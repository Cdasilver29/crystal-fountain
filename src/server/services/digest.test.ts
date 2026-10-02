import { describe, expect, it } from "vitest";

import { renderDailyDigest } from "@/server/email/daily-digest";

import { digestSchedule, isEmpty, type DigestData } from "./digest";

/** The job's own time, 21:05 UTC, which is 00:05 the next day in Nairobi. */
const run = (utcDate: string) => new Date(`${utcDate}T21:05:00Z`);

describe("digestSchedule", () => {
  it("skips the run dated Saturday in Nairobi, which UTC still calls Friday", () => {
    // Friday 2 October 2026, 21:05 UTC, is Saturday 00:05 in Nairobi.
    expect(digestSchedule(run("2026-10-02"))).toEqual({ send: false, reason: "sabbath" });
  });

  it("rolls Saturday into Sunday's run, looking back 48 hours", () => {
    expect(digestSchedule(run("2026-10-03"))).toEqual({ send: true, windowHours: 48 });
  });

  it("looks back 24 hours on every other day", () => {
    for (const day of ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]) {
      expect(digestSchedule(run(day)), day).toEqual({ send: true, windowHours: 24 });
    }
  });

  it("goes by the Nairobi date, not the server's", () => {
    // Saturday 10:00 in Nairobi is still Saturday whatever UTC says.
    expect(digestSchedule(new Date("2026-10-03T07:00:00Z")).send).toBe(false);
    // Saturday 23:30 UTC is already Sunday 02:30 in Nairobi.
    expect(digestSchedule(new Date("2026-10-03T23:30:00Z"))).toEqual({
      send: true,
      windowHours: 48,
    });
  });
});

const empty: DigestData = {
  since: new Date("2026-10-04T21:05:00Z"),
  pledges: { count: 0, newPledges: 0, additions: 0, totalMinor: 0n, largest: null },
  waiting: { heldAdditions: 0, changeRequests: 0, pendingPledges: 0, pendingPaymentChanges: 0 },
  settings: [],
};

describe("isEmpty", () => {
  it("is empty only when nothing happened and nothing waits", () => {
    expect(isEmpty(empty)).toBe(true);
    expect(isEmpty({ ...empty, waiting: { ...empty.waiting, changeRequests: 1 } })).toBe(false);
    expect(isEmpty({ ...empty, pledges: { ...empty.pledges, count: 1 } })).toBe(false);
    expect(
      isEmpty({
        ...empty,
        settings: [{ at: new Date(), action: "campaign.updated", byName: "A", moves: [] }],
      }),
    ).toBe(false);
  });
});

describe("renderDailyDigest", () => {
  const full: DigestData = {
    since: new Date("2026-10-04T21:05:00Z"),
    pledges: {
      count: 3,
      newPledges: 2,
      additions: 1,
      totalMinor: 1_250_000_00n,
      largest: {
        pledgeId: "11111111-1111-1111-1111-111111111111",
        reference: "CF26-000412",
        name: "Grace <b>Kamau</b>",
        amountMinor: 1_000_000_00n,
      },
    },
    waiting: { heldAdditions: 1, changeRequests: 2, pendingPledges: 0, pendingPaymentChanges: 1 },
    settings: [
      {
        at: new Date("2026-10-05T08:00:00Z"),
        action: "campaign.updated",
        byName: "Moses",
        moves: [{ field: "autoApproveLimitMinor", was: "500000000", now: "100000000" }],
      },
      {
        at: new Date("2026-10-05T09:00:00Z"),
        action: "campaign.payment_change_requested",
        byName: "Moses",
        moves: [],
      },
    ],
  };

  const message = renderDailyDigest(full, {
    siteUrl: "https://pledge.example.test/",
    windowHours: 24,
  });

  it("states the figures, the largest pledge and the queues", () => {
    expect(message.text).toContain("3 pledges in the last 24 hours (2 new, 1 added to existing), KES 1,250,000 in total.");
    expect(message.text).toContain("Largest: KES 1,000,000 from Grace <b>Kamau</b>, CF26-000412.");
    expect(message.text).toContain("1 held addition to confirm with the pledger.");
    expect(message.text).toContain("2 change requests to answer.");
    expect(message.text).toContain("1 payment details change waiting for a second person.");
    expect(message.text).not.toContain("pending approval");
    expect(message.subject).toBe("Daily summary: 3 pledges, 4 waiting");
  });

  it("reports settings changes in the same words as the settings notice", () => {
    expect(message.text).toContain("Auto approve limit: KES 5,000,000 to KES 1,000,000, by Moses");
    expect(message.text).toContain("Payment details change requested, by Moses");
  });

  it("links into the portal", () => {
    expect(message.text).toContain("https://pledge.example.test/admin/held-additions");
    expect(message.text).toContain(
      "https://pledge.example.test/admin/pledges/11111111-1111-1111-1111-111111111111",
    );
    expect(message.html).toContain('href="https://pledge.example.test/admin/change-requests"');
  });

  it("escapes the name in the HTML", () => {
    expect(message.html).not.toContain("<b>Kamau</b>");
    expect(message.html).toContain("Grace &lt;b&gt;Kamau&lt;/b&gt;");
  });

  it("says 48 hours on Sunday", () => {
    const sunday = renderDailyDigest(full, { siteUrl: "https://x.test", windowHours: 48 });
    expect(sunday.text).toContain("in the last 48 hours");
  });
});
