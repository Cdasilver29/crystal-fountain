import * as Sentry from "@sentry/nextjs";

import { env } from "@/env";
import { resendBaseUrlRefused, type EmailConfig } from "@/server/services/email";

/**
 * Where email's configuration comes from. Every route and notice that sends
 * builds its configuration here and nowhere else, so the refusal below covers
 * every confirmation, notice and digest.
 *
 * On production, a RESEND_BASE_URL that is not Resend's own address refuses
 * every send: each one comes back failed, which the callers report, and email
 * counts as not configured, so a change that has to be announced waits. It is
 * also reported to Sentry here, once per running instance, so the cause is
 * named even if no email happens to be attempted.
 */

let reported = false;

export function emailConfig(): EmailConfig {
  const refused = resendBaseUrlRefused(
    process.env.RESEND_BASE_URL,
    process.env.VERCEL_ENV,
  );

  if (refused && !reported) {
    reported = true;
    Sentry.captureMessage(
      "Email refused: RESEND_BASE_URL is set on production to something other than Resend's own address",
      { level: "error", tags: { area: "email_config" } },
    );
  }

  return {
    apiKey: env.RESEND_API_KEY,
    from: env.RESEND_FROM_EMAIL,
    ...(refused ? { refused: "foreign_base_url" as const } : {}),
  };
}
