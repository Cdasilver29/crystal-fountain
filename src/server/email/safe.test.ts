import { describe, expect, it } from "vitest";

import { renderAdditionHeldNotice } from "./held-addition";
import {
  NOT_YOU_LINE,
  renderPledgeConfirmationEmail,
} from "./pledge-confirmation";
import { escapeHtml, greeting, greetingName } from "./safe";

/** Anything a mail client could turn into a link. */
const LINKISH = /https?:|www\.|\.[a-z]{2,}\/|[a-z0-9-]+\.(ly|com|org|net|io|ke|co)\b/i;

describe("greetingName", () => {
  it("keeps an ordinary first name", () => {
    expect(greetingName("Grace Wanjiku Kamau")).toBe("Grace");
    expect(greetingName("  Mary-Anne O'Brien ")).toBe("Mary-Anne");
    expect(greetingName("N\u2019gang\u2019a Otieno")).toBe("N\u2019gang\u2019a");
  });

  it("keeps letters in any script, right to left included", () => {
    expect(greetingName("\u0641\u0627\u0637\u0645\u0629 \u0639\u0644\u064A")).toBe(
      "\u0641\u0627\u0637\u0645\u0629",
    );
    expect(greetingName("\u12A0\u1260\u1260 \u1260\u1240\u1208")).toBe("\u12A0\u1260\u1260");
  });

  it("composes to NFC, so a decomposed accent stays one letter", () => {
    expect(greetingName("Rene\u0301e")).toBe("Ren\u00E9e");
  });

  it("cannot carry a web address, wherever it sits in the name", () => {
    for (const name of [
      "Verify your M-Pesa at bit.ly/xyz",
      "bit.ly/xyz",
      "https://evil.example/login",
      "www.evil.example",
      "mpesa-verify.co.ke Jane",
      "Jane\u200B.com",
      "evil.example",
    ]) {
      const got = greetingName(name) ?? "";
      expect(got, name).not.toMatch(LINKISH);
      expect(got, name).toMatch(/^[\p{L}\p{M}'\u2019-]*$/u);
    }
  });

  it("takes only the first word, so nothing after it travels", () => {
    expect(greetingName("Verify your M-Pesa at bit.ly/xyz")).toBe("Verify");
  });

  it("is at most thirty characters", () => {
    const got = greetingName("A".repeat(80));
    expect(got).toHaveLength(30);
  });

  it("gives nothing when nothing is left", () => {
    for (const name of ["", "   ", "1234 5678", "...", "--", null, undefined]) {
      expect(greetingName(name), String(name)).toBeNull();
      expect(greeting(name)).toBe("Dear member");
    }
  });

  it("strips digits and punctuation from inside a word", () => {
    expect(greetingName("J0hn")).toBe("J");
    expect(greeting("John2")).toBe("Dear John");
  });
});

describe("escapeHtml", () => {
  it("escapes markup and quotes, ampersand first", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});

const base = {
  reference: "CF26-000124",
  publicToken: "abcdefghijklmnopqrstuv",
  amountMinor: 500_000n,
  addedMinor: 500_000n,
  isAddition: false,
  installmentFrequency: null,
  details: { paybill: "123456", bankName: "Bank", bankAccount: "000111" },
  siteUrl: "https://pledge.example.test",
} as const;

describe("the pledge confirmation", () => {
  it("greets a phishing name without the link and carries the footer", () => {
    const message = renderPledgeConfirmationEmail({
      ...base,
      fullName: "Verify your M-Pesa at bit.ly/xyz",
    });

    expect(message.text).toContain("Dear Verify,");
    expect(message.html + message.text).not.toContain("bit.ly");
    expect(message.html + message.text).not.toContain("M-Pesa at");
    expect(message.text).toContain(NOT_YOU_LINE);
    expect(message.text).toContain("Development office: 0722619788");
    expect(message.html).toContain(
      "If you did not make this pledge, you can ignore this email, or contact the development office.",
    );
    expect(message.html).toContain("0722619788");
  });

  it("greets a member whose name leaves nothing", () => {
    const message = renderPledgeConfirmationEmail({ ...base, fullName: "http://x.y" });
    // "http" is letters, and nothing link shaped survives with it.
    expect(message.text).toContain("Dear http,");
    expect(message.text).not.toContain("x.y");

    const empty = renderPledgeConfirmationEmail({ ...base, fullName: "12345" });
    expect(empty.text).toContain("Dear member,");
    expect(empty.html).toContain("Dear member,");
  });

  it("escapes markup in a name before anything else sees it", () => {
    const message = renderPledgeConfirmationEmail({
      ...base,
      fullName: "<img src=x onerror=alert(1)>",
    });
    expect(message.html).not.toContain("<img");
    expect(message.html).not.toContain("onerror");
  });
});

describe("the held addition notice", () => {
  it("greets from the record name with the same rule", () => {
    const message = renderAdditionHeldNotice({
      fullName: "www.evil.example Grace",
      reference: "CF26-000124",
      addedMinor: 500_000n,
      siteUrl: "https://pledge.example.test",
    });
    expect(message.html + message.text).not.toContain("evil.example");
    expect(message.text).toContain("Dear www,");
  });
});
