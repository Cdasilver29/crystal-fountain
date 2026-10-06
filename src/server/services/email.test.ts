import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isEmailConfigured,
  RESEND_API_ORIGIN,
  resendBaseUrlRefused,
  sendPledgeConfirmation,
  sendRendered,
  type EmailConfig,
} from "./email";

describe("resendBaseUrlRefused", () => {
  it("refuses any other address on production", () => {
    for (const url of [
      "http://127.0.0.1:3999",
      "https://api.resend.com.evil.example",
      "https://example.org/api.resend.com",
      "not a url",
    ]) {
      expect(resendBaseUrlRefused(url, "production")).toBe(true);
    }
  });

  it("allows it unset, empty, or Resend's own address on production", () => {
    expect(resendBaseUrlRefused(undefined, "production")).toBe(false);
    expect(resendBaseUrlRefused("", "production")).toBe(false);
    expect(resendBaseUrlRefused("  ", "production")).toBe(false);
    expect(resendBaseUrlRefused(RESEND_API_ORIGIN, "production")).toBe(false);
    expect(resendBaseUrlRefused(`${RESEND_API_ORIGIN}/`, "production")).toBe(false);
  });

  it("allows a stand in everywhere but production", () => {
    expect(resendBaseUrlRefused("http://127.0.0.1:3999", "preview")).toBe(false);
    expect(resendBaseUrlRefused("http://127.0.0.1:3999", undefined)).toBe(false);
  });
});

describe("a refused configuration", () => {
  const refused: EmailConfig = {
    apiKey: "re_live_looking_key",
    from: "Crystal Fountain <dev@example.org>",
    refused: "foreign_base_url",
  };

  afterEach(() => vi.restoreAllMocks());

  it("is not configured email, so announced changes wait", () => {
    expect(isEmailConfigured(refused)).toBe(false);
    expect(isEmailConfigured({ ...refused, refused: undefined })).toBe(true);
  });

  it("fails every send loudly and never reaches the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const message = { subject: "s", html: "<p>h</p>", text: "t" };

    const notice = await sendRendered(refused, { to: "a@example.org", message, tag: "t" });
    expect(notice.status).toBe("failed");
    expect(notice.status === "failed" && notice.error.message).toMatch(/RESEND_BASE_URL/);

    const confirmation = await sendPledgeConfirmation(refused, {
      to: "a@example.org",
      pledge: {} as never,
    });
    expect(confirmation.status).toBe("failed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/*
 * The refusal only protects sends whose configuration comes from
 * src/lib/email-config.ts. A route that built its own would slip past it.
 */
describe("every sender takes its configuration from emailConfig()", () => {
  it("names the API key in no other source file", () => {
    const root = join(process.cwd(), "src");
    const offenders = (readdirSync(root, { recursive: true }) as string[])
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
      .filter((file) => !/^env\.ts$|[\\/]email-config\.ts$/.test(file))
      .filter((file) => readFileSync(join(root, file), "utf8").includes("env.RESEND_API_KEY"));
    expect(offenders).toEqual([]);
  });
});
