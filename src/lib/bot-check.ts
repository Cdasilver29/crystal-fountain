import { env } from "@/env";
import {
  assertHuman,
  siteHostnames,
  turnstileBypassAllowed,
  turnstileTestingAllowed,
  type TurnstileAction,
  type TurnstileConfig,
} from "@/server/services/turnstile";

/**
 * Where the bot check's configuration comes from.
 *
 * The one place that reads the environment for it. The service takes all of
 * this as data, so the policy stays testable without an environment, and every
 * public form gets the same answer from the same source.
 */
export function turnstileConfig(): TurnstileConfig {
  return {
    keys: {
      siteKey: env.TURNSTILE_SITE_KEY,
      secretKey: env.TURNSTILE_SECRET_KEY,
    },
    bypassAllowed: turnstileBypassAllowed(process.env.NODE_ENV),
    testingAllowed: turnstileTestingAllowed(process.env.VERCEL_ENV),
    allowedHostnames: siteHostnames(env.NEXT_PUBLIC_SITE_URL),
    siteverifyUrl: env.TURNSTILE_SITEVERIFY_URL,
  };
}

/**
 * The bot check for one of the /redeem forms, from a route handler.
 *
 * Throws a ServiceError when the submission is refused, which the caller's
 * serviceProblem turns into the response.
 */
export function requireHuman(args: {
  action: TurnstileAction;
  token: string | null | undefined;
  ip: string | null;
}): Promise<void> {
  return assertHuman({ config: turnstileConfig(), ...args });
}

/** The site key the widgets render with, or null when the check is off. */
export function turnstileSiteKey(): string | null {
  return env.TURNSTILE_SITE_KEY?.trim() || null;
}
