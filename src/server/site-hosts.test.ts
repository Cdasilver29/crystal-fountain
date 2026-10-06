import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { crossSiteReason, SITE_HOSTNAMES, siteHostnames } from "./site-hosts";

const LIVE = "https://development.newlifesdanairobi.org";

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

describe("siteHostnames", () => {
  it("is the two site addresses on production, and nothing else", () => {
    const hosts = siteHostnames(LIVE, {
      vercelEnv: "production",
      vercelUrl: "crystal-fountain-abc123.vercel.app",
    });
    expect([...hosts].sort()).toEqual([...SITE_HOSTNAMES].sort());
  });

  it("adds loopback and the preview's own addresses outside production", () => {
    const preview = siteHostnames(LIVE, {
      vercelEnv: "preview",
      vercelUrl: "crystal-fountain-abc123.vercel.app",
      vercelBranchUrl: "crystal-fountain-git-fix-team.vercel.app",
    });
    expect(preview).toContain("crystal-fountain-abc123.vercel.app");
    expect(preview).toContain("crystal-fountain-git-fix-team.vercel.app");
    expect(preview).toContain("localhost");

    const laptop = siteHostnames(LIVE, { vercelEnv: undefined });
    expect(laptop).toContain("localhost");
    expect(laptop).toContain("127.0.0.1");
  });

  it("is the strict list when no deployment is given", () => {
    expect(siteHostnames(LIVE)).not.toContain("localhost");
  });
});

describe("crossSiteReason", () => {
  const production = siteHostnames(LIVE, { vercelEnv: "production" });
  const laptop = siteHostnames(LIVE, { vercelEnv: undefined });

  it("accepts both site addresses", () => {
    for (const host of SITE_HOSTNAMES) {
      expect(crossSiteReason(headers({ origin: `https://${host}` }), production)).toBeNull();
      expect(
        crossSiteReason(headers({ origin: `https://${host}`, "sec-fetch-site": "same-origin" }), production),
      ).toBeNull();
    }
  });

  it("accepts a request with no Origin and no fetch metadata", () => {
    expect(crossSiteReason(headers({}), production)).toBeNull();
  });

  it("refuses a foreign origin, a lookalike, and the parent domain", () => {
    for (const origin of [
      "https://evil.example",
      "https://crystal-fountain.vercel.app.evil.example",
      "https://newlifesdanairobi.org",
      "null",
      "not a url",
    ]) {
      expect(crossSiteReason(headers({ origin }), production)).toBe("foreign_origin");
    }
  });

  it("refuses a cross-site fetch even with no Origin", () => {
    expect(crossSiteReason(headers({ "sec-fetch-site": "cross-site" }), production)).toBe(
      "cross_site_fetch",
    );
    expect(
      crossSiteReason(headers({ "sec-fetch-site": "cross-site", origin: LIVE }), production),
    ).toBe("cross_site_fetch");
  });

  it("refuses plain http on a real host, allows it on loopback off production", () => {
    expect(
      crossSiteReason(headers({ origin: "http://development.newlifesdanairobi.org" }), production),
    ).toBe("foreign_origin");
    expect(crossSiteReason(headers({ origin: "http://localhost:3000" }), laptop)).toBeNull();
    expect(crossSiteReason(headers({ origin: "http://localhost:3000" }), production)).toBe(
      "foreign_origin",
    );
  });
});

/*
 * Every state changing handler calls the check before anything else. A scan
 * rather than a list, so a handler added later is covered the day it is
 * written. Better Auth's routes and the cron route are left to their own
 * checks.
 */
describe("every POST, PATCH, PUT and DELETE handler", () => {
  const root = join(process.cwd(), "src", "app", "api");
  const files = (readdirSync(root, { recursive: true }) as string[])
    .filter((file) => /route\.tsx?$/.test(file))
    .filter((file) => !/^(auth|cron)[\\/]/.test(file));

  const handlers = files.flatMap((file) => {
    const source = readFileSync(join(root, file), "utf8");
    return [...source.matchAll(/export async function (POST|PATCH|PUT|DELETE)\([\s\S]*?\{\n([\s\S]*?)\n\n/g)].map(
      (match) => ({ name: `${match[1]} ${file}`, firstStatement: match[2] }),
    );
  });

  it("finds the handlers", () => {
    expect(handlers.length).toBeGreaterThanOrEqual(26);
  });

  for (const handler of handlers) {
    it(`${handler.name} refuses cross site requests first`, () => {
      expect(handler.firstStatement).toBe(
        "  const crossSite = refuseCrossSite(request);\n  if (crossSite) return crossSite;",
      );
    });
  }
});
