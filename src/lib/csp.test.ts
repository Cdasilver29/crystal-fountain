import { describe, expect, it } from "vitest";

import { contentSecurityPolicy, cspHeaders, sentryReportUri } from "./csp";

const DSN = "https://abc123@o42.ingest.de.sentry.io/4507";

function directive(policy: string, name: string): string[] {
  const found = policy.split("; ").find((d) => d.startsWith(`${name} `));
  return found ? found.split(" ").slice(1) : [];
}

describe("sentryReportUri", () => {
  it("builds the security endpoint from a DSN", () => {
    expect(sentryReportUri(DSN, "production")).toBe(
      "https://o42.ingest.de.sentry.io/api/4507/security/?sentry_key=abc123&sentry_environment=production",
    );
  });

  it("returns null for a missing or unusable DSN", () => {
    expect(sentryReportUri(undefined, "production")).toBeNull();
    expect(sentryReportUri("", "production")).toBeNull();
    expect(sentryReportUri("not a url", "production")).toBeNull();
    expect(sentryReportUri("https://o42.ingest.sentry.io/4507", "x")).toBeNull();
    expect(sentryReportUri("http://k@o42.ingest.sentry.io/4507", "x")).toBeNull();
  });
});

describe("contentSecurityPolicy", () => {
  const production = contentSecurityPolicy({
    vercelEnv: "production",
    nodeEnv: "production",
    reportUri: "https://report.example/x",
  });

  it("carries the fixed lockdown directives", () => {
    expect(directive(production, "default-src")).toEqual(["'self'"]);
    expect(directive(production, "object-src")).toEqual(["'none'"]);
    expect(directive(production, "base-uri")).toEqual(["'self'"]);
    expect(directive(production, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(production, "form-action")).toEqual(["'self'"]);
  });

  it("allows Turnstile and the YouTube player, and no other image host", () => {
    expect(directive(production, "script-src")).toContain("https://challenges.cloudflare.com");
    expect(directive(production, "frame-src")).toEqual([
      "https://challenges.cloudflare.com",
      "https://www.youtube-nocookie.com",
    ]);
    expect(directive(production, "img-src")).toEqual(["'self'", "data:"]);
  });

  it("allows no eval and no Vercel toolbar in production", () => {
    expect(directive(production, "script-src")).not.toContain("'unsafe-eval'");
    expect(production).not.toContain("vercel.live");
    expect(directive(production, "connect-src")).toEqual(["'self'"]);
  });

  it("adds the toolbar origins on previews only", () => {
    const preview = contentSecurityPolicy({
      vercelEnv: "preview",
      nodeEnv: "production",
      reportUri: null,
    });
    expect(directive(preview, "script-src")).toContain("https://vercel.live");
    expect(directive(preview, "frame-src")).toContain("https://vercel.live");
    expect(directive(preview, "connect-src")).toContain("wss://ws-us3.pusher.com");
  });

  it("allows eval in development only", () => {
    const dev = contentSecurityPolicy({
      vercelEnv: undefined,
      nodeEnv: "development",
      reportUri: null,
    });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
  });

  it("names both report-uri and report-to when it has an endpoint", () => {
    expect(directive(production, "report-uri")).toEqual(["https://report.example/x"]);
    expect(directive(production, "report-to")).toEqual(["csp-endpoint"]);
  });
});

describe("cspHeaders", () => {
  it("sends the policy report-only, never enforcing", () => {
    const headers = cspHeaders({ vercelEnv: "production", nodeEnv: "production", sentryDsn: DSN });
    const keys = headers.map((h) => h.key);
    expect(keys).toContain("Content-Security-Policy-Report-Only");
    expect(keys).not.toContain("Content-Security-Policy");
    expect(keys).toContain("Reporting-Endpoints");
    expect(keys).toContain("Report-To");
  });

  it("still sends the policy, without reporting, when there is no DSN", () => {
    const headers = cspHeaders({ vercelEnv: "production", nodeEnv: "production", sentryDsn: undefined });
    expect(headers.map((h) => h.key)).toEqual(["Content-Security-Policy-Report-Only"]);
    expect(headers[0].value).not.toContain("report-uri");
  });
});
