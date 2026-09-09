import { timingSafeEqual } from "node:crypto";

import { db } from "@/db";
import { env } from "@/env";
import { problem, serviceProblem } from "@/lib/api";
import { CAMPAIGN_SLUG } from "@/lib/campaign";
import * as snapshots from "@/server/services/snapshots";

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
 */
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

    return Response.json({
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
