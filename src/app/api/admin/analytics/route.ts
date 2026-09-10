import { db } from "@/db";
import { getCurrentAdmin } from "@/lib/admin-context";
import { problem, serviceProblem } from "@/lib/api";
import { CAMPAIGN_SLUG } from "@/lib/campaign";
import * as analytics from "@/server/services/analytics";

export const dynamic = "force-dynamic";

/** Five minutes, matching the public timeseries endpoint. */
const MAX_AGE_SECONDS = 300;

/**
 * GET /api/admin/analytics
 *
 * The four figures on /admin/analytics that are not already served by
 * /api/campaign/summary or /api/campaign/timeseries: the fulfilment rate, the
 * ageing buckets, the channel mix and the weekly trend.
 *
 * Any signed in admin, including a viewer. There is nothing here to act on and
 * nothing that names anybody, so there is no write to gate and no contact
 * detail to withhold.
 *
 * Read only, so there is no audit row. CLAUDE.md requires one for every admin
 * write, and this writes nothing.
 *
 * Cached private and not public, unlike the timeseries endpoint. Five minutes
 * is what the brief asks for, but the response is only correct for somebody
 * holding an admin session, so it must sit in that person's own browser cache
 * and never in a shared proxy where the next caller would be handed it without
 * a session at all.
 *
 * No aggregate here identifies a person, but the ageing buckets are a
 * collections report and the church has no reason to publish one.
 */
export async function GET() {
  const admin = await getCurrentAdmin();

  if (!admin) {
    return problem(401, "unauthorized", "Sign in to continue.");
  }

  try {
    const [fulfilment, ageing, channels, weekly] = await Promise.all([
      analytics.fulfilment(db, { campaignSlug: CAMPAIGN_SLUG }),
      analytics.ageing(db, { campaignSlug: CAMPAIGN_SLUG }),
      analytics.channelMix(db, { campaignSlug: CAMPAIGN_SLUG }),
      analytics.weekly(db, { campaignSlug: CAMPAIGN_SLUG }),
    ]);

    return Response.json(
      {
        // Amounts always cross the wire as integer minor unit strings with an
        // explicit currency, per PLAN.md section 13.
        currency: "KES",

        fulfilment: {
          allocatedMinor: fulfilment.allocatedMinor.toString(),
          promisedMinor: fulfilment.promisedMinor.toString(),
          ratePercent: fulfilment.ratePercent,
        },

        ageing: {
          totalPledges: ageing.totalPledges,
          totalOutstandingMinor: ageing.totalOutstandingMinor.toString(),
          buckets: ageing.buckets.map((bucket) => ({
            key: bucket.key,
            label: bucket.label,
            pledgeCount: bucket.pledgeCount,
            outstandingMinor: bucket.outstandingMinor.toString(),
          })),
        },

        channels: channels.map((row) => ({
          channel: row.channel,
          label: row.label,
          pledgeCount: row.pledgeCount,
          totalMinor: row.totalMinor.toString(),
        })),

        weekly: weekly.map((week) => ({
          isoWeek: week.isoWeek,
          weekStart: week.weekStart,
          newPledges: week.newPledges,
          newPledgedMinor: week.newPledgedMinor.toString(),
        })),
      },
      {
        headers: {
          "cache-control": `private, max-age=${MAX_AGE_SECONDS}`,
        },
      },
    );
  } catch (error) {
    return serviceProblem(error);
  }
}
