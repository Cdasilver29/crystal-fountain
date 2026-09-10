import { ServiceError } from "@/server/errors";

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
};

export type TurnstileResult = {
  ok: boolean;
  /** Cloudflare's own error codes, for the log. Never shown to a pledger. */
  errorCodes: string[];
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
    return { ok: false, errorCodes: ["missing-input-response"] };
  }

  const body = new FormData();
  body.append("secret", args.secretKey);
  body.append("response", token);
  if (args.ip) body.append("remoteip", args.ip);

  let response: Response;

  try {
    response = await fetch(SITEVERIFY_URL, {
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
  } | null;

  return {
    ok: payload?.success === true,
    errorCodes: payload?.["error-codes"] ?? [],
  };
}
