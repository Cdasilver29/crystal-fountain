import {
  TURNSTILE_ACTIONS,
  type TurnstileAction,
} from "@/server/contracts/turnstile";
import { ServiceError } from "@/server/errors";

export { TURNSTILE_ACTIONS, type TurnstileAction };

/**
 * Cloudflare Turnstile verification.
 *
 * A plain function taking a typed input, per the architecture rule in
 * CLAUDE.md. Nothing here reads process.env, touches Request or Response, or
 * knows what a route handler is: the keys and the caller's IP arrive as data,
 * so the whole thing is callable from a test with no environment at all.
 *
 * https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** How long to wait for Cloudflare before giving up. */
export const VERIFY_TIMEOUT_MS = 5_000;

export type TurnstileKeys = {
  siteKey: string | undefined;
  secretKey: string | undefined;
};

export type VerifyTurnstileArgs = {
  /** The token the widget produced, as the client sent it. */
  token: string | null | undefined;
  secretKey: string;
  /** The submitter's IP, when there is a plausible one. Optional to Cloudflare. */
  ip?: string | null;
  /**
   * Where to ask. Cloudflare unless a verification run points it at a local
   * stand in; see turnstileTestingAllowed for when that is honoured.
   */
  siteverifyUrl?: string;
};

export type TurnstileResult = {
  ok: boolean;
  /** Cloudflare's own error codes, for the log. Never shown to a pledger. */
  errorCodes: string[];
  /** The action the widget was rendered with, as Cloudflare signed it. */
  action?: string;
  /** The hostname of the page the widget was solved on. */
  hostname?: string;
  /**
   * True when the answer came from one of Cloudflare's documented test
   * secrets, which pass or fail every token regardless and carry neither an
   * action nor a real hostname.
   */
  testingKey: boolean;
};

/**
 * Whether Turnstile is switched on.
 *
 * Both keys or neither. A half configured pair is refused rather than guessed
 * at, because both ways of guessing are bad: treating it as on renders a widget
 * with no site key and nobody can pledge, and treating it as off silently drops
 * the bot check on a form that takes money.
 */
export function isTurnstileConfigured(keys: TurnstileKeys): boolean {
  const site = keys.siteKey?.trim() ?? "";
  const secret = keys.secretKey?.trim() ?? "";

  if (site !== "" && secret !== "") return true;
  if (site === "" && secret === "") return false;

  throw new ServiceError(
    "turnstile_misconfigured",
    "Turnstile is half configured. Set both TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY, or neither.",
    500,
  );
}

/**
 * Whether running without Turnstile is allowed here.
 *
 * Only off production. The bypass exists so the form works on a laptop with no
 * Cloudflare account, and a missing environment variable on Vercel must not be
 * able to quietly turn the bot check off on a live form that takes money. In
 * production, absent keys are a failed deploy, not an open door.
 */
export function turnstileBypassAllowed(nodeEnv: string | undefined): boolean {
  return nodeEnv !== "production";
}

/**
 * Asks Cloudflare whether a token is good.
 *
 * Never throws for a token Cloudflare rejects: that is an answer, and it comes
 * back as ok false. It throws only when Cloudflare could not be asked at all,
 * because a network failure is not evidence that the submitter is a robot and
 * must not be reported to them as though it were.
 */
export async function verify(
  args: VerifyTurnstileArgs,
): Promise<TurnstileResult> {
  const token = args.token?.trim() ?? "";

  // No token at all never needs a round trip to be wrong.
  if (token === "") {
    return {
      ok: false,
      errorCodes: ["missing-input-response"],
      testingKey: false,
    };
  }

  const body = new FormData();
  body.append("secret", args.secretKey);
  body.append("response", token);
  if (args.ip) body.append("remoteip", args.ip);

  let response: Response;

  try {
    response = await fetch(args.siteverifyUrl ?? SITEVERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    console.error("turnstile siteverify failed", error);
    throw new ServiceError(
      "turnstile_unavailable",
      "We could not complete the security check. Please try again in a moment.",
      503,
    );
  }

  if (!response.ok) {
    throw new ServiceError(
      "turnstile_unavailable",
      "We could not complete the security check. Please try again in a moment.",
      503,
    );
  }

  const payload = (await response.json().catch(() => null)) as {
    success?: boolean;
    "error-codes"?: string[];
    action?: unknown;
    hostname?: unknown;
    metadata?: { result_with_testing_key?: unknown };
  } | null;

  return {
    ok: payload?.success === true,
    errorCodes: payload?.["error-codes"] ?? [],
    action: typeof payload?.action === "string" ? payload.action : undefined,
    hostname:
      typeof payload?.hostname === "string" ? payload.hostname : undefined,
    testingKey: payload?.metadata?.result_with_testing_key === true,
  };
}

/**
 * Whether Cloudflare's test secrets and a stand in siteverify are accepted.
 *
 * Never on the production deployment. A test secret passes every token, so
 * one configured there by mistake would be no bot check at all, and a stand
 * in siteverify is whatever answers at that address. Everywhere else, a
 * laptop or a verification run against a database branch, both are how the
 * real verification path gets exercised without a person solving a puzzle.
 *
 * Keyed on Vercel's own VERCEL_ENV rather than NODE_ENV, because a
 * verification run builds and starts the app in production mode on purpose.
 */
export function turnstileTestingAllowed(vercelEnv: string | undefined): boolean {
  return vercelEnv !== "production";
}

/**
 * Every address the site is served from.
 *
 * The church subdomain is the public origin, but members still arrive on the
 * Vercel address from links shared before it existed, and the forms there
 * must work too. Exact names only: a lookalike such as
 * crystal-fountain.vercel.app.example.com is a different host and is refused.
 */
export const SITE_HOSTNAMES = [
  "development.newlifesdanairobi.org",
  "crystal-fountain.vercel.app",
] as const;

/**
 * The hostnames a token may have been solved on: the site's own.
 *
 * The addresses above, plus the configured public origin in case it ever
 * moves before this list does. A token solved on any other page, somebody
 * else's copy of the form with our site key lifted into it, is refused.
 */
export function siteHostnames(siteUrl: string | undefined): string[] {
  const hosts = new Set<string>(SITE_HOSTNAMES);
  try {
    hosts.add(new URL(siteUrl ?? "").hostname.toLowerCase());
  } catch {
    // An unreadable origin adds nothing; the known addresses still stand.
  }
  return [...hosts];
}

/** Why a token Cloudflare accepted was still refused. For the log only. */
export type ClaimProblem =
  | "action_mismatch"
  | "hostname_mismatch"
  | "testing_key";

/**
 * Checks what Cloudflare signed into a token it accepted.
 *
 * Pure, so the rules are tested without a network. An empty or missing action
 * or hostname is a mismatch, not a pass: a widget rendered without an action
 * is not one of ours.
 */
export function checkClaims(
  result: Pick<TurnstileResult, "action" | "hostname" | "testingKey">,
  expected: {
    action: TurnstileAction;
    hostnames: readonly string[];
    testingAllowed: boolean;
  },
): ClaimProblem | null {
  if (result.testingKey) {
    // A test secret signs no action and reports example.com. Off production
    // that is the documented way to test; on it, it is refused outright.
    return expected.testingAllowed ? null : "testing_key";
  }

  if (!result.action || result.action !== expected.action) {
    return "action_mismatch";
  }

  const hostname = result.hostname?.toLowerCase() ?? "";
  if (hostname === "" || !expected.hostnames.includes(hostname)) {
    return "hostname_mismatch";
  }

  return null;
}

/** Everything about the deployment that the bot check depends on. */
export type TurnstileConfig = {
  keys: TurnstileKeys;
  /** Whether running with no keys at all is permitted. Never in production. */
  bypassAllowed: boolean;
  /** Whether test secrets and a stand in siteverify are accepted. */
  testingAllowed: boolean;
  /** The site's own hostnames. Empty refuses every token. */
  allowedHostnames: readonly string[];
  /** A stand in siteverify, honoured only when testingAllowed. */
  siteverifyUrl?: string;
};

const NOT_CONFIGURED =
  "The security check is not configured. Please try again later, or call the development office.";

/**
 * The whole bot check for one public form.
 *
 * Resolves when the submission is through: verified, or Turnstile switched
 * off somewhere that is allowed. Throws for everything else: a token
 * Cloudflare refused, one solved on another form or another site, a half
 * configured pair, and absent keys where absence is not allowed.
 */
export async function assertHuman(args: {
  config: TurnstileConfig;
  action: TurnstileAction;
  token: string | null | undefined;
  ip?: string | null;
}): Promise<void> {
  const { config } = args;

  // Throws on a half configured pair rather than picking one of two bad guesses.
  if (!isTurnstileConfigured(config.keys)) {
    if (!config.bypassAllowed) {
      throw new ServiceError("turnstile_misconfigured", NOT_CONFIGURED, 500);
    }
    // A laptop with no Cloudflare account.
    return;
  }

  const siteverifyUrl = config.siteverifyUrl?.trim() || undefined;
  if (siteverifyUrl && !config.testingAllowed) {
    // Somebody pointed production at another verifier. Refuse rather than ask it.
    throw new ServiceError("turnstile_misconfigured", NOT_CONFIGURED, 500);
  }

  const result = await verify({
    token: args.token,
    secretKey: config.keys.secretKey!,
    ip: args.ip,
    siteverifyUrl,
  });

  const problem = result.ok
    ? checkClaims(result, {
        action: args.action,
        hostnames: config.allowedHostnames,
        testingAllowed: config.testingAllowed,
      })
    : null;

  if (!result.ok || problem) {
    // Cloudflare's codes and our own reason are for us. The person is told
    // what to do next.
    console.warn("turnstile refused a submission", {
      action: args.action,
      errorCodes: result.errorCodes,
      problem,
    });
    throw new ServiceError(
      "turnstile_failed",
      "The security check did not pass. Please complete it again and resubmit.",
      422,
    );
  }
}
