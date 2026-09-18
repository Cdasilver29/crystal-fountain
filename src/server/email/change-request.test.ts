import { describe, expect, it } from "vitest";

import {
  renderChangeRequestAcknowledgement,
  renderChangeRequestDecision,
  type RequestedChange,
} from "@/server/email/change-request";

/**
 * The three change request messages.
 *
 * Pure functions of their input, so the whole of their behaviour can be
 * asserted without an API key, a database or a send. What is being checked is
 * mostly the wording somebody actually reads: that an acknowledgement says
 * nothing has happened yet, that a decline carries the treasurer's note, and
 * that a name typed into a public form cannot put markup into an email.
 */

const SITE = "https://development.newlifesdanairobi.org";

const reduction: RequestedChange = {
  kind: "reduce_amount",
  requestedAmountMinor: 30000000n,
  requestedFrequency: null,
  requestedName: null,
  paymentReference: null,
  paymentAmountMinor: null,
};

const cancellation: RequestedChange = {
  kind: "cancel_pledge",
  requestedAmountMinor: null,
  requestedFrequency: null,
  requestedName: null,
  paymentReference: null,
  paymentAmountMinor: null,
};

describe("the acknowledgement", () => {
  const message = renderChangeRequestAcknowledgement({
    fullName: "Tabitha Wairimu",
    reference: "CF26-000124",
    change: reduction,
    siteUrl: SITE,
  });

  it("names the reference in the subject, so it is findable later", () => {
    expect(message.subject).toContain("CF26-000124");
  });

  it("greets them by their first name only", () => {
    expect(message.html).toContain("Dear Tabitha");
    expect(message.html).not.toContain("Wairimu");
  });

  it("says what they asked for, in their own terms", () => {
    expect(message.html).toContain("lower your pledge to KES 300,000");
  });

  /*
   * The whole job of this message. Somebody who asks for a reduction and then
   * sees their old figure on the site would otherwise think it failed, and
   * ring the treasurer about it.
   */
  it("says plainly that nothing has changed yet", () => {
    expect(message.html).toContain("Nothing has changed yet");
    expect(message.text).toContain("Nothing has changed yet");
  });

  it("comes with a plain text alternative that is not markup", () => {
    expect(message.text).not.toContain("<p");
    expect(message.text).not.toContain("&amp;");
    expect(message.text).toContain("lower your pledge to KES 300,000");
  });
});

describe("the decision", () => {
  const approved = renderChangeRequestDecision({
    fullName: "Tabitha Wairimu",
    reference: "CF26-000124",
    change: reduction,
    decision: "approved",
    note: null,
    amountMinor: 30000000n,
    siteUrl: SITE,
  });

  const declined = renderChangeRequestDecision({
    fullName: "Tabitha Wairimu",
    reference: "CF26-000124",
    change: reduction,
    decision: "declined",
    note: "You have already paid this in full, so there is nothing to reduce.",
    amountMinor: 50000000n,
    siteUrl: SITE,
  });

  it("says which way it went", () => {
    expect(approved.html).toContain("approved");
    expect(declined.html).toContain("not been able to approve");
  });

  it("quotes the new figure on an approval", () => {
    expect(approved.html).toContain("KES 300,000");
  });

  it("says the pledge is unchanged on a decline", () => {
    expect(declined.html).toContain("Your pledge is unchanged");
  });

  /*
   * The note is the decision as much as the word is. A no with nothing after
   * it leaves somebody unable to tell whether to correct something and ask
   * again or to ring, which is why the contract will not accept one without.
   */
  it("carries the treasurer's note on a decline", () => {
    expect(declined.html).toContain("already paid this in full");
    expect(declined.text).toContain("already paid this in full");
  });

  it("does not invent a note on an approval that has none", () => {
    expect(approved.html).not.toContain("They said");
  });

  it("does not quote a figure for an approved cancellation", () => {
    const closed = renderChangeRequestDecision({
      fullName: "Tabitha Wairimu",
      reference: "CF26-000124",
      change: cancellation,
      decision: "approved",
      note: null,
      amountMinor: 25000000n,
      siteUrl: SITE,
    });

    expect(closed.html).toContain("has been closed");
    // Quoting a figure here would read as though it were still owed.
    expect(closed.html).not.toContain("now stands at");
  });

  it("subjects read differently, so an inbox can tell them apart", () => {
    expect(approved.subject).not.toBe(declined.subject);
    expect(approved.subject).toContain("approved");
  });
});

describe("what a person typed", () => {
  /*
   * The name and the note are typed into forms anybody can reach, and they are
   * interpolated into markup.
   */
  it("escapes a name carrying markup", () => {
    const message = renderChangeRequestAcknowledgement({
      fullName: "Tabitha Wairimu",
      reference: "CF26-000124",
      change: {
        ...cancellation,
        kind: "correct_name",
        requestedName: "<script>alert(1)</script>",
      },
      siteUrl: SITE,
    });

    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&lt;script&gt;");
  });

  it("escapes a decision note carrying markup", () => {
    const message = renderChangeRequestDecision({
      fullName: "Tabitha Wairimu",
      reference: "CF26-000124",
      change: reduction,
      decision: "declined",
      note: "Ring <b>us</b> about this, it is complicated.",
      amountMinor: 50000000n,
      siteUrl: SITE,
    });

    expect(message.html).not.toContain("<b>us</b>");
    expect(message.html).toContain("&lt;b&gt;");
  });

  it("leaves the plain text alternative unescaped, as text", () => {
    const message = renderChangeRequestDecision({
      fullName: "Tabitha Wairimu",
      reference: "CF26-000124",
      change: {
        ...cancellation,
        kind: "correct_name",
        requestedName: "Smith & Sons",
      },
      decision: "approved",
      note: null,
      amountMinor: 50000000n,
      siteUrl: SITE,
    });

    expect(message.text).toContain("Smith & Sons");
    expect(message.text).not.toContain("&amp;");
    expect(message.html).toContain("Smith &amp; Sons");
  });

  it("falls back rather than greeting nobody", () => {
    const message = renderChangeRequestAcknowledgement({
      fullName: "   ",
      reference: "CF26-000124",
      change: reduction,
      siteUrl: SITE,
    });

    expect(message.html).toContain("Dear friend");
    expect(message.html).not.toContain("Dear ,");
  });
});

describe("every kind says something", () => {
  const kinds: RequestedChange[] = [
    reduction,
    cancellation,
    {
      ...cancellation,
      kind: "change_plan",
      requestedFrequency: "monthly",
    },
    {
      ...cancellation,
      kind: "correct_name",
      requestedName: "Jane Otieno",
    },
    {
      ...cancellation,
      kind: "payment_missing",
      paymentReference: "QGH7X8K9LM",
      paymentAmountMinor: 5000000n,
    },
  ];

  it("renders an acknowledgement for each", () => {
    for (const change of kinds) {
      const message = renderChangeRequestAcknowledgement({
        fullName: "Tabitha Wairimu",
        reference: "CF26-000124",
        change,
        siteUrl: SITE,
      });

      expect(message.subject.length, change.kind).toBeGreaterThan(0);
      // No half built sentence from a missing field.
      expect(message.html, change.kind).not.toContain("undefined");
      expect(message.html, change.kind).not.toContain("null");
    }
  });

  it("names what was asked in each", () => {
    const [, , plan, name, payment] = kinds;

    const of = (change: RequestedChange) =>
      renderChangeRequestAcknowledgement({
        fullName: "Tabitha Wairimu",
        reference: "CF26-000124",
        change,
        siteUrl: SITE,
      }).html;

    expect(of(plan)).toContain("monthly");
    expect(of(name)).toContain("Jane Otieno");
    expect(of(payment)).toContain("QGH7X8K9LM");
    expect(of(payment)).toContain("KES 50,000");
  });
});
