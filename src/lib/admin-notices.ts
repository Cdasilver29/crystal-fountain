import * as Sentry from "@sentry/nextjs";
import { after } from "next/server";

import { db } from "@/db";
import { env } from "@/env";
import { problem } from "@/lib/api";
import { renderPaymentChangeNotice } from "@/server/email/payment-change";
import { isEmailConfigured, sendAdminNotice } from "@/server/services/email";
import {
  noticeRecipients,
  type PaymentChangeNotice,
} from "@/server/services/payment-changes";

/**
 * Emailing every administrator about payment detail changes.
 *
 * The only place that knows where the email configuration comes from, so the
 * service stays a plain function and the routes stay thin.
 */

function emailConfig() {
  return { apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM_EMAIL };
}

/**
 * Refuses a payment detail change when the administrators cannot be told.
 *
 * The emails are how a substitution gets noticed, so a change that cannot be
 * announced is not allowed to happen: in production, with no email key, the
 * request and the approval are both refused. Outside production a laptop with
 * no Resend account can still exercise the flow. Returns a response to send
 * back, or null to carry on.
 */
export function refuseWithoutNotices(): Response | null {
  if (isEmailConfigured(emailConfig())) return null;
  if (process.env.NODE_ENV !== "production") return null;

  return problem(
    503,
    "payment_change_notices_unavailable",
    "Email is not configured, so the administrators cannot be told about this change. Payment details cannot be changed until it is.",
  );
}

/**
 * Sends each notice to every active administrator, after the response.
 *
 * Scheduled with after() for the same reason as the pledge confirmation: the
 * decision is already committed and an email cannot fail it. A failed send is
 * reported to Sentry by change id and outcome only, never by address.
 */
export function notifyPaymentChanges(notices: PaymentChangeNotice[]): void {
  if (notices.length === 0) return;

  const task = async () => {
    const to = await noticeRecipients(db);

    for (const notice of notices) {
      const results = await sendAdminNotice(emailConfig(), {
        to,
        message: renderPaymentChangeNotice(notice, {
          siteUrl: env.NEXT_PUBLIC_SITE_URL,
        }),
        tag: `payment_change_${notice.event}`,
      });

      const failed = results.filter((r) => r.status === "failed").length;
      if (failed > 0) {
        Sentry.captureMessage("payment change notice not delivered", {
          tags: { area: "payment_change_notice" },
          extra: { changeId: notice.changeId, event: notice.event, failed, of: to.length },
        });
      }
    }
  };

  try {
    after(() => task().catch((error) => Sentry.captureException(error)));
  } catch {
    void task().catch((error) => Sentry.captureException(error));
  }
}
