import { timingSafeEqual } from "node:crypto";

import * as Sentry from "@sentry/nextjs";

import { db } from "@/db";
import { env } from "@/env";
import { notifyPaymentChanges } from "@/lib/admin-notices";
import { problem, serviceProblem } from "@/lib/api";
import { CAMPAIGN_SLUG } from "@/lib/campaign";
import { renderDailyDigest } from "@/server/email/daily-digest";
import * as digest from "@/server/services/digest";
import { isEmailConfigured, sendAdminNotice } from "@/server/services/email";
import * as paymentChanges from "@/server/services/payment-changes";
import * as retention from "@/server/services/retention";
import * as snapshots from "@/server/services/snapshots";
import { emailConfig } from "@/lib/email-config";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/daily-snapshot
 *
 * Records the campaign as it stands, once a day. This is the job that gives
 * campaign_daily_stats a history; without it the table stays empty and every
 * chart drawn from it is a flat line.
 *
 * Scheduled in vercel.json for 21:05 UTC, which is just after midnight in
 * Nairobi, so each run closes the day that has just ended rather than
 * photographing one in progress.
 *
 * Authenticated by a shared secret, compared in constant time. Vercel Cron
 * sends it as a bearer token; the header form is accepted too so the job can be
 * triggered by hand during an incident.
 *
 * If CRON_SECRET is unset the route refuses everything. That is deliberate: an
 * unauthenticated endpoint that writes to the table the public charts read is
 * not something that should quietly work because a variable was forgotten.
 *
 * Idempotent. Running it twice in a day rewrites the same row rather than
 * doubling it, so a retry after a timeout is safe.
 *
 * The one daily schedule, so it also clears rate limit rows past 48 hours
 * and expired payment changes past 30 days (see retention.ts), and sends the
 * daily digest to administrators and treasurers (see digest.ts). Each of
 * those is guarded on its own: a failed digest does not lose the snapshot,
 * and a failed prune does not stop the digest. A retry may send the digest a
 * second time, which is the lesser harm next to never sending it.
 */
/**
 * The daily digest: decides, gathers, renders, sends.
 *
 * Says what it did as a value for the job's response, which is where a run is
 * checked from. Never names a recipient, only how many.
 */
async function sendDigest(now: Date): Promise<
  | { status: "skipped"; reason: "sabbath" | "nothing_to_report" | "not_configured" | "no_recipients" }
  | { status: "sent"; windowHours: 24 | 48; recipients: number; failed: number }
> {
  const schedule = digest.digestSchedule(now);
  if (!schedule.send) return { status: "skipped", reason: schedule.reason };

  const config = emailConfig();
  if (!isEmailConfigured(config)) return { status: "skipped", reason: "not_configured" };

  const data = await digest.gather(db, {
    campaignSlug: CAMPAIGN_SLUG,
    since: new Date(now.getTime() - schedule.windowHours * 60 * 60 * 1000),
  });
  if (digest.isEmpty(data)) return { status: "skipped", reason: "nothing_to_report" };

  const to = await digest.recipients(db);
  if (to.length === 0) return { status: "skipped", reason: "no_recipients" };

  const results = await sendAdminNotice(config, {
    to,
    message: renderDailyDigest(data, {
      siteUrl: env.NEXT_PUBLIC_SITE_URL,
      windowHours: schedule.windowHours,
    }),
    tag: "daily_digest",
  });

  const failed = results.filter((r) => r.status === "failed").length;
  if (failed > 0) {
    Sentry.captureMessage("daily digest not delivered", {
      tags: { area: "daily_digest" },
      extra: { failed, of: to.length },
    });
  }

  return {
    status: "sent",
    windowHours: schedule.windowHours,
    recipients: to.length,
    failed,
  };
}

function authorised(request: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;

  const header =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.headers.get("x-cron-secret") ??
    "";

  const a = Buffer.from(header);
  const b = Buffer.from(secret);

  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length, so the lengths are compared first and the result folded in.
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!authorised(request)) {
    // Says nothing about whether the secret is unset or merely wrong.
    return problem(401, "unauthorized", "This endpoint is not available.");
  }

  try {
    const statDate = snapshots.today();
    const row = await snapshots.writeSnapshot(db, {
      campaignSlug: CAMPAIGN_SLUG,
      statDate,
    });

    /*
     * Payment detail changes past their seven days. Also swept whenever the
     * settings are saved or a change is decided, but those only happen when
     * somebody is in the portal, and an expiry nobody hears about is one the
     * requester may go on waiting for.
     */
    const expired = await paymentChanges.expireStale(db);
    notifyPaymentChanges(expired);

    const pruned = await retention.prune(db).catch((error: unknown) => {
      Sentry.captureException(error, { tags: { area: "retention_prune" } });
      return null;
    });

    const digestOutcome = await sendDigest(new Date()).catch((error: unknown) => {
      Sentry.captureException(error, { tags: { area: "daily_digest" } });
      return { status: "failed" as const };
    });

    return Response.json({
      pruned,
      digest: digestOutcome,
      expiredPaymentChanges: expired.length,
      statDate: row.statDate,
      // Amounts cross the wire as integer minor unit strings, per PLAN.md
      // section 13.
      pledgedMinor: row.pledgedMinor.toString(),
      receivedMinor: row.receivedMinor.toString(),
      pledgeCount: row.pledgeCount,
      pledgerCount: row.pledgerCount,
      newPledges: row.newPledges,
      newPledgedMinor: row.newPledgedMinor.toString(),
    });
  } catch (error) {
    return serviceProblem(error);
  }
}
