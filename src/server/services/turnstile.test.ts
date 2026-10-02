import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertHuman,
  checkClaims,
  SITE_HOSTNAMES,
  siteHostnames,
  TURNSTILE_ACTIONS,
  turnstileTestingAllowed,
  type TurnstileConfig,
} from "./turnstile";

const HOST = "pledge.newlifesdanairobi.org";
/** What NEXT_PUBLIC_SITE_URL is set to on the live deployment. */
const LIVE_ORIGIN = "https://development.newlifesdanairobi.org";

const config = (over: Partial<TurnstileConfig> = {}): TurnstileConfig => ({
  keys: { siteKey: "site", secretKey: "secret" },
  bypassAllowed: false,
  testingAllowed: false,
  allowedHostnames: [HOST],
  ...over,
});

/** Stands in for siteverify with whatever Cloudflare would have said. */
function answer(payload: Record<string, unknown>) {
  const fetchMock = vi.fn(async () => Response.json(payload));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("checkClaims", () => {
  const expected = {
    action: TURNSTILE_ACTIONS.redeemLookup,
    hostnames: [HOST],
    testingAllowed: false,
  };

  it("passes the right action on our own hostname", () => {
    expect(
      checkClaims(
        { action: "redeem_lookup", hostname: HOST, testingKey: false },
        expected,
      ),
    ).toBeNull();
  });

  it("refuses a token solved on another form", () => {
    expect(
      checkClaims(
        { action: "pledge", hostname: HOST, testingKey: false },
        expected,
      ),
    ).toBe("action_mismatch");
  });

  it("refuses a token with no action at all", () => {
    expect(
      checkClaims({ action: "", hostname: HOST, testingKey: false }, expected),
    ).toBe("action_mismatch");
    expect(
      checkClaims({ hostname: HOST, testingKey: false }, expected),
    ).toBe("action_mismatch");
  });

  it("refuses a token solved on a foreign hostname", () => {
    expect(
      checkClaims(
        { action: "redeem_lookup", hostname: "evil.example", testingKey: false },
        expected,
      ),
    ).toBe("hostname_mismatch");
  });

  it("does not take a lookalike subdomain for ours", () => {
    expect(
      checkClaims(
        {
          action: "redeem_lookup",
          hostname: `${HOST}.evil.example`,
          testingKey: false,
        },
        expected,
      ),
    ).toBe("hostname_mismatch");
  });

  it("refuses everything when no hostname is allowed", () => {
    expect(
      checkClaims(
        { action: "redeem_lookup", hostname: HOST, testingKey: false },
        { ...expected, hostnames: [] },
      ),
    ).toBe("hostname_mismatch");
  });

  it("takes a test secret's answer only where testing is allowed", () => {
    const testing = { hostname: "example.com", testingKey: true };
    expect(checkClaims(testing, expected)).toBe("testing_key");
    expect(
      checkClaims(testing, { ...expected, testingAllowed: true }),
    ).toBeNull();
  });
});

describe("siteHostnames and turnstileTestingAllowed", () => {
  it("accepts exactly the two addresses the site is served from", () => {
    expect([...siteHostnames(LIVE_ORIGIN)].sort()).toEqual(
      ["crystal-fountain.vercel.app", "development.newlifesdanairobi.org"],
    );
  });

  it("adds the configured origin if it is ever somewhere else", () => {
    expect(siteHostnames(`https://${HOST.toUpperCase()}/x`)).toContain(HOST);
  });

  it("keeps the known addresses when the origin is unreadable", () => {
    expect([...siteHostnames("not a url")].sort()).toEqual([...SITE_HOSTNAMES].sort());
    expect([...siteHostnames(undefined)].sort()).toEqual([...SITE_HOSTNAMES].sort());
  });

  it("refuses testing on the production deployment only", () => {
    expect(turnstileTestingAllowed("production")).toBe(false);
    expect(turnstileTestingAllowed("preview")).toBe(true);
    expect(turnstileTestingAllowed(undefined)).toBe(true);
  });
});

describe("every form on both addresses", () => {
  const live = config({ allowedHostnames: siteHostnames(LIVE_ORIGIN) });

  for (const hostname of SITE_HOSTNAMES) {
    for (const action of Object.values(TURNSTILE_ACTIONS)) {
      it(`${action} passes on ${hostname}`, async () => {
        answer({ success: true, action, hostname });
        await expect(
          assertHuman({ config: live, action, token: "t" }),
        ).resolves.toBeUndefined();
      });

      it(`${action} refuses a lookalike of ${hostname}`, async () => {
        answer({ success: true, action, hostname: `${hostname}.example.com` });
        await expect(
          assertHuman({ config: live, action, token: "t" }),
        ).rejects.toMatchObject({ code: "turnstile_failed" });
      });
    }
  }
});

describe("assertHuman", () => {
  it("passes a good token for this form on this site", async () => {
    answer({ success: true, action: "change_request", hostname: HOST });
    await expect(
      assertHuman({
        config: config(),
        action: TURNSTILE_ACTIONS.changeRequest,
        token: "t",
      }),
    ).resolves.toBeUndefined();
  });

  it("refuses a lookup token replayed on the consent form", async () => {
    answer({ success: true, action: "redeem_lookup", hostname: HOST });
    await expect(
      assertHuman({
        config: config(),
        action: TURNSTILE_ACTIONS.withdrawConsent,
        token: "t",
      }),
    ).rejects.toMatchObject({ code: "turnstile_failed", status: 422 });
  });

  it("refuses a token from a foreign hostname", async () => {
    answer({ success: true, action: "pledge", hostname: "copy.example" });
    await expect(
      assertHuman({
        config: config(),
        action: TURNSTILE_ACTIONS.pledge,
        token: "t",
      }),
    ).rejects.toMatchObject({ code: "turnstile_failed" });
  });

  it("refuses what Cloudflare refused, claims or not", async () => {
    answer({ success: false, action: "pledge", hostname: HOST });
    await expect(
      assertHuman({
        config: config(),
        action: TURNSTILE_ACTIONS.pledge,
        token: "t",
      }),
    ).rejects.toMatchObject({ code: "turnstile_failed" });
  });

  it("refuses a missing token without asking anybody", async () => {
    const fetchMock = answer({ success: true });
    await expect(
      assertHuman({
        config: config(),
        action: TURNSTILE_ACTIONS.redeemLookup,
        token: "  ",
      }),
    ).rejects.toMatchObject({ code: "turnstile_failed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a test secret's pass on production", async () => {
    answer({
      success: true,
      hostname: "example.com",
      metadata: { result_with_testing_key: true },
    });
    await expect(
      assertHuman({
        config: config(),
        action: TURNSTILE_ACTIONS.pledge,
        token: "t",
      }),
    ).rejects.toMatchObject({ code: "turnstile_failed" });
  });

  it("refuses absent keys where bypass is not allowed", async () => {
    await expect(
      assertHuman({
        config: config({ keys: { siteKey: "", secretKey: undefined } }),
        action: TURNSTILE_ACTIONS.redeemLookup,
        token: null,
      }),
    ).rejects.toMatchObject({ code: "turnstile_misconfigured", status: 500 });
  });

  it("lets a laptop with no keys through", async () => {
    await expect(
      assertHuman({
        config: config({
          keys: { siteKey: undefined, secretKey: undefined },
          bypassAllowed: true,
        }),
        action: TURNSTILE_ACTIONS.redeemLookup,
        token: null,
      }),
    ).resolves.toBeUndefined();
  });

  it("refuses a half configured pair even where bypass is allowed", async () => {
    await expect(
      assertHuman({
        config: config({
          keys: { siteKey: "site", secretKey: undefined },
          bypassAllowed: true,
        }),
        action: TURNSTILE_ACTIONS.redeemLookup,
        token: "t",
      }),
    ).rejects.toMatchObject({ code: "turnstile_misconfigured" });
  });

  it("will not ask a stand in verifier on production", async () => {
    const fetchMock = answer({ success: true, action: "pledge", hostname: HOST });
    await expect(
      assertHuman({
        config: config({ siteverifyUrl: "http://127.0.0.1:9/siteverify" }),
        action: TURNSTILE_ACTIONS.pledge,
        token: "t",
      }),
    ).rejects.toMatchObject({ code: "turnstile_misconfigured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks the stand in verifier where testing is allowed", async () => {
    const fetchMock = answer({ success: true, action: "pledge", hostname: HOST });
    await assertHuman({
      config: config({
        testingAllowed: true,
        siteverifyUrl: "http://127.0.0.1:9/siteverify",
      }),
      action: TURNSTILE_ACTIONS.pledge,
      token: "t",
    });
    expect((fetchMock.mock.calls[0] as unknown[] | undefined)?.[0]).toBe("http://127.0.0.1:9/siteverify");
  });
});
