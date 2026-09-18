import { describe, expect, it } from "vitest";

import {
  CHANGE_REQUEST_KINDS,
  changeRequestInput,
  decideChangeRequestInput,
  reduceAmountRefusal,
} from "@/server/contracts/change-requests";

/**
 * The change request contract.
 *
 * The union is the first of the two gates in front of this table. It is the one
 * that produces a sentence somebody can act on; the check constraints in
 * migration 0015 are the one that holds whatever route a row arrives by. Both
 * are asserted, the constraints in the verification suite against a real
 * database and the union here.
 *
 * What is being proved is mostly negative: that a kind cannot carry another
 * kind's fields. A single loose object with everything optional would pass
 * every positive test in this file and none of the negative ones.
 */

const REFERENCE = "CF26-000124";
const PHONE = "0712345678";
const NORMALISED_PHONE = "+254712345678";
const REASON = "My circumstances have changed since I pledged.";

const base = {
  reference: REFERENCE,
  contactPhoneE164: PHONE,
  reason: REASON,
};

describe("the union as a whole", () => {
  it("covers every kind the database accepts", () => {
    for (const kind of CHANGE_REQUEST_KINDS) {
      const parsed = changeRequestInput.safeParse({
        ...base,
        kind,
        // Whichever extra fields this kind needs. A kind that needs none
        // ignores all of them, which is the next test.
        requestedAmountMinor: "50000000",
        requestedFrequency: "monthly",
        requestedName: "Jane Otieno",
        paymentReference: "QGH7X8K9LM",
        paymentAmountMinor: "500000",
        paymentPaidOn: "2026-09-01",
      });

      expect(parsed.success, kind).toBe(true);
    }
  });

  it("refuses a kind it has never heard of", () => {
    const parsed = changeRequestInput.safeParse({
      ...base,
      kind: "change_phone",
    });

    expect(parsed.success).toBe(false);
  });

  it("normalises the phone number with the one normaliser", () => {
    const parsed = changeRequestInput.parse({
      ...base,
      kind: "cancel_pledge",
      contactPhoneE164: "0712 345 678",
    });

    expect(parsed.contactPhoneE164).toBe(NORMALISED_PHONE);
  });

  it("repairs a reference typed without its dash", () => {
    const parsed = changeRequestInput.parse({
      ...base,
      kind: "cancel_pledge",
      reference: "cf26000124",
    });

    expect(parsed.reference).toBe(REFERENCE);
  });

  it("wants a reason of some substance, whatever the kind", () => {
    for (const kind of CHANGE_REQUEST_KINDS) {
      const parsed = changeRequestInput.safeParse({
        ...base,
        kind,
        reason: "no",
        requestedAmountMinor: "50000000",
        requestedFrequency: "monthly",
        requestedName: "Jane Otieno",
        paymentReference: "QGH7X8K9LM",
        paymentAmountMinor: "500000",
        paymentPaidOn: "2026-09-01",
      });

      expect(parsed.success, kind).toBe(false);
    }
  });
});

describe("each kind carries only its own fields", () => {
  it("a reduction keeps its amount and drops everything else", () => {
    const parsed = changeRequestInput.parse({
      ...base,
      kind: "reduce_amount",
      requestedAmountMinor: "50000000",
      paymentReference: "QGH7X8K9LM",
      requestedName: "Jane Otieno",
    });

    expect(parsed).toEqual({
      kind: "reduce_amount",
      reference: REFERENCE,
      contactPhoneE164: NORMALISED_PHONE,
      reason: REASON,
      requestedAmountMinor: 50000000n,
    });
  });

  it("a name correction carries no payment reference", () => {
    const parsed = changeRequestInput.parse({
      ...base,
      kind: "correct_name",
      requestedName: "Jane Otieno",
      paymentReference: "QGH7X8K9LM",
      paymentAmountMinor: "500000",
      paymentPaidOn: "2026-09-01",
    });

    expect(parsed).not.toHaveProperty("paymentReference");
    expect(parsed).not.toHaveProperty("paymentAmountMinor");
    expect(parsed).not.toHaveProperty("paymentPaidOn");
  });

  it("a cancellation asks for nothing but a reason", () => {
    const parsed = changeRequestInput.parse({
      ...base,
      kind: "cancel_pledge",
      requestedAmountMinor: "50000000",
    });

    expect(parsed).not.toHaveProperty("requestedAmountMinor");
  });
});

describe("reduce_amount", () => {
  const reduce = (fields: Record<string, unknown>) =>
    changeRequestInput.safeParse({ ...base, kind: "reduce_amount", ...fields });

  it("needs an amount", () => {
    expect(reduce({}).success).toBe(false);
  });

  it("reads minor units from a string and from a number alike", () => {
    const asString = changeRequestInput.parse({
      ...base,
      kind: "reduce_amount",
      requestedAmountMinor: "50000000",
    });
    const asNumber = changeRequestInput.parse({
      ...base,
      kind: "reduce_amount",
      requestedAmountMinor: 50000000,
    });

    expect(asString).toEqual(asNumber);
  });

  it("refuses an amount carrying cents", () => {
    expect(reduce({ requestedAmountMinor: "50000050" }).success).toBe(false);
  });

  it("refuses a float, which has already lost the argument", () => {
    expect(reduce({ requestedAmountMinor: 50000000.5 }).success).toBe(false);
  });

  it("holds the same floor and ceiling as a pledge amount", () => {
    // KES 99, one shilling under the smallest pledge.
    expect(reduce({ requestedAmountMinor: "9900" }).success).toBe(false);
    expect(reduce({ requestedAmountMinor: "10000" }).success).toBe(true);
    // KES 1,000,000,001.
    expect(reduce({ requestedAmountMinor: "100000000100" }).success).toBe(false);
  });

  it("refuses a negative amount before the database has to", () => {
    expect(reduce({ requestedAmountMinor: "-10000" }).success).toBe(false);
    expect(reduce({ requestedAmountMinor: -10000 }).success).toBe(false);
  });
});

describe("the less than rule", () => {
  it("passes a genuine reduction", () => {
    expect(reduceAmountRefusal(40000000n, 50000000n)).toBeNull();
  });

  it("refuses the amount the pledge already stands at", () => {
    const refusal = reduceAmountRefusal(50000000n, 50000000n);

    expect(refusal).not.toBeNull();
    expect(refusal).toContain("already");
  });

  it("refuses an increase and points at the pledge form", () => {
    const refusal = reduceAmountRefusal(60000000n, 50000000n);

    expect(refusal).not.toBeNull();
    // The whole point of refusing rather than queueing: that path exists and
    // needs nobody's approval.
    expect(refusal).toContain("another pledge");
    expect(refusal).toContain("same phone number");
  });

  it("is exact one shilling either side of the current amount", () => {
    expect(reduceAmountRefusal(49999900n, 50000000n)).toBeNull();
    expect(reduceAmountRefusal(50000100n, 50000000n)).not.toBeNull();
  });
});

describe("change_plan", () => {
  it("takes one off as well as the instalment frequencies", () => {
    for (const frequency of [
      "one_off",
      "monthly",
      "quarterly",
      "semi_annually",
      "annually",
    ]) {
      const parsed = changeRequestInput.safeParse({
        ...base,
        kind: "change_plan",
        requestedFrequency: frequency,
      });

      expect(parsed.success, frequency).toBe(true);
    }
  });

  it("refuses a frequency the pledge column would not accept", () => {
    const parsed = changeRequestInput.safeParse({
      ...base,
      kind: "change_plan",
      requestedFrequency: "weekly",
    });

    expect(parsed.success).toBe(false);
  });

  it("needs a frequency", () => {
    expect(
      changeRequestInput.safeParse({ ...base, kind: "change_plan" }).success,
    ).toBe(false);
  });
});

describe("correct_name", () => {
  const name = (value: unknown) =>
    changeRequestInput.safeParse({
      ...base,
      kind: "correct_name",
      requestedName: value,
    });

  it("trims what was typed", () => {
    const parsed = changeRequestInput.parse({
      ...base,
      kind: "correct_name",
      requestedName: "  Jane Otieno  ",
    });

    expect(parsed).toMatchObject({ requestedName: "Jane Otieno" });
  });

  it("wants at least two characters", () => {
    expect(name("J").success).toBe(false);
    expect(name("Jo").success).toBe(true);
  });

  it("stops at one hundred and twenty", () => {
    expect(name("a".repeat(120)).success).toBe(true);
    expect(name("a".repeat(121)).success).toBe(false);
  });

  it("counts length after trimming, not before", () => {
    expect(name("   J   ").success).toBe(false);
  });
});

describe("payment_missing", () => {
  const payment = (fields: Record<string, unknown>) =>
    changeRequestInput.safeParse({
      ...base,
      kind: "payment_missing",
      paymentReference: "QGH7X8K9LM",
      paymentAmountMinor: "500000",
      paymentPaidOn: "2026-09-01",
      ...fields,
    });

  it("needs all three of the reference, the amount and the date", () => {
    expect(payment({ paymentReference: undefined }).success).toBe(false);
    expect(payment({ paymentAmountMinor: undefined }).success).toBe(false);
    expect(payment({ paymentPaidOn: undefined }).success).toBe(false);
  });

  it("upper cases the reference, so it matches a recorded payment", () => {
    const parsed = changeRequestInput.parse({
      ...base,
      kind: "payment_missing",
      paymentReference: " qgh7x8k9lm ",
      paymentAmountMinor: "500000",
      paymentPaidOn: "2026-09-01",
    });

    expect(parsed).toMatchObject({ paymentReference: "QGH7X8K9LM" });
  });

  it("wants a positive amount", () => {
    expect(payment({ paymentAmountMinor: "0" }).success).toBe(false);
    expect(payment({ paymentAmountMinor: "-500000" }).success).toBe(false);
  });

  it("refuses a date in the future", () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    expect(payment({ paymentPaidOn: tomorrow }).success).toBe(false);
  });

  it("accepts today, because somebody paying now is the common case", () => {
    const today = new Date().toISOString().slice(0, 10);

    expect(payment({ paymentPaidOn: today }).success).toBe(true);
  });

  it("refuses something that is not a date at all", () => {
    expect(payment({ paymentPaidOn: "last Tuesday" }).success).toBe(false);
  });
});

describe("deciding one", () => {
  const decide = (value: unknown) => decideChangeRequestInput.safeParse(value);

  it("approves without a note", () => {
    expect(decide({ decision: "approve" }).success).toBe(true);
  });

  it("lets an approval carry one anyway", () => {
    const parsed = decideChangeRequestInput.parse({
      decision: "approve",
      note: "Spoke to them on the phone and they confirmed it.",
    });

    expect(parsed).toMatchObject({ decision: "approve" });
  });

  /*
   * The pledger is told the answer. A no with nothing after it leaves them
   * unable to tell whether to correct something and ask again or to ring the
   * treasurer, so the note is the decision as much as the word is.
   */
  it("refuses a decline with no note", () => {
    expect(decide({ decision: "decline" }).success).toBe(false);
  });

  it("refuses a decline with a note too short to act on", () => {
    expect(decide({ decision: "decline", note: "no" }).success).toBe(false);
    expect(decide({ decision: "decline", note: "no thanks" }).success).toBe(false);
  });

  it("accepts one at exactly ten characters", () => {
    expect(decide({ decision: "decline", note: "0123456789" }).success).toBe(true);
  });

  it("counts the note after trimming, not before", () => {
    expect(decide({ decision: "decline", note: "  no  " }).success).toBe(false);
  });

  it("refuses a decision nobody has heard of", () => {
    expect(decide({ decision: "defer", note: "Let us wait a while." }).success).toBe(
      false,
    );
  });
});
