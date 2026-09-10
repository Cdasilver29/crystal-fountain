import { db } from "@/db";
import { serviceProblem } from "@/lib/api";
import { CAMPAIGN_SLUG } from "@/lib/campaign";
import * as snapshots from "@/server/services/snapshots";

export const dynamic = "force-dynamic";

/** Five minutes. The history moves once a day; this only needs to not be stale. */
const MAX_AGE_SECONDS = 300;

/**
 * GET /api/campaign/timeseries
 *
 * The daily campaign history, oldest first. Public, because it is the same
 * aggregate the progress chart draws and nothing in it identifies anybody.
 *
 * Aggregates only, per CLAUDE.md: counts and amounts, no names, no phone
 * numbers, not even a pledge reference. A row here cannot be traced to a
 * person even by someone who already knows what they gave.
 *
 * Cached at the edge for five minutes. The underlying rows change once a day
 * when the snapshot job runs, so this is generous rather than tight, and it
 * keeps a WhatsApp surge on the progress page off the database.
 */
export async function GET() {
  try {
    const rows = await snapshots.series(db, { campaignSlug: CAMPAIGN_SLUG });

    return Response.json(
      {
        // Amounts always cross the wire as integer minor unit strings with an
        // explicit currency, per PLAN.md section 13.
        currency: "KES",
        days: rows.map((row) => ({
          date: row.statDate,
          pledgedMinor: row.pledgedMinor.toString(),
          receivedMinor: row.receivedMinor.toString(),
          pledgeCount: row.pledgeCount,
          pledgerCount: row.pledgerCount,
          newPledges: row.newPledges,
          newPledgedMinor: row.newPledgedMinor.toString(),
        })),
      },
      {
        headers: {
          "cache-control": `public, max-age=0, s-maxage=${MAX_AGE_SECONDS}, stale-while-revalidate=${MAX_AGE_SECONDS}`,
        },
      },
    );
  } catch (error) {
    return serviceProblem(error);
  }
}
