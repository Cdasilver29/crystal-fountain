import * as Sentry from "@sentry/nextjs";
import { after } from "next/server";

import { db } from "@/db";
import { env } from "@/env";
import { problem } from "@/lib/api";
import { emailConfig } from "@/lib/email-config";
import { builtInPaymentDetails } from "@/lib/payment-details";
import { renderPaymentChangeNotice } from "@/server/email/payment-change";
import { renderSettingsChangedNotice } from "@/server/email/settings-change";
import type { SettingMove } from "@/server/services/campaign";
import { isEmailConfigured, sendAdminNotice } from "@/server/services/email";
import {
  noticeRecipients,
  type PaymentChangeNotice,
} from "@/server/services/payment-changes";

/**
 * Emailing every administrator about payment detail and settings changes.
 *
 * The only place that knows where the email configuration comes from, so the
 * service stays a plain function and the routes stay thin.
 */

/**
 * Refuses a change the administrators cannot be told about.
 *
 * The emails are how a substitution or a quietly moved figure gets noticed, so
 * a change that cannot be announced is not allowed to happen: in production,
 * with no email key, a payment detail request, its approval, and a change to
 * the target, the opening balance or the auto approve limit are all refused.
 * Closing or opening the pledge form is not, because closing it is what
 * somebody reaches for in an emergency, and an email outage must not stop it.
 *
 * Outside production a laptop with no Resend account can still exercise the
 * flow. Returns a response to send back, or null to carry on.
 */
export function refuseWithoutNotices(): Response | null {
  if (isEmailConfigured(emailConfig())) return null;
  if (process.env.NODE_ENV !== "production") return null;

  return problem(
    503,
    "admin_notices_unavailable",
    "Email is not configured, so the administrators cannot be told about this change. It cannot be made until email is working.",
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

  schedule(async () => {
    const to = await noticeRecipients(db);

    for (const notice of notices) {
      const results = await sendAdminNotice(emailConfig(), {
        to,
        message: renderPaymentChangeNotice(notice, {
          siteUrl: env.NEXT_PUBLIC_SITE_URL,
          builtIn: builtInPaymentDetails(),
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
  });
}

/**
 * Tells every active administrator that settings changed and are already live.
 * Same delivery as the payment notices, so the same reasons apply.
 */
export function notifySettingsChanged(args: {
  moved: SettingMove[];
  changedByName: string;
}): void {
  if (args.moved.length === 0) return;

  schedule(async () => {
    const to = await noticeRecipients(db);
    const results = await sendAdminNotice(emailConfig(), {
      to,
      message: renderSettingsChangedNotice({
        moved: args.moved,
        changedByName: args.changedByName,
        siteUrl: env.NEXT_PUBLIC_SITE_URL,
      }),
      tag: "settings_changed",
    });

    const failed = results.filter((r) => r.status === "failed").length;
    if (failed > 0) {
      Sentry.captureMessage("settings change notice not delivered", {
        tags: { area: "settings_change_notice" },
        extra: { fields: args.moved.map((m) => m.field), failed, of: to.length },
      });
    }
  });
}

/** After the response where there is a request context, detached otherwise. */
function schedule(task: () => Promise<void>): void {
  try {
    after(() => task().catch((error) => Sentry.captureException(error)));
  } catch {
    void task().catch((error) => Sentry.captureException(error));
  }
}
