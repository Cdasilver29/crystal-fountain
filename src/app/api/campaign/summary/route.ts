import { serviceProblem } from "@/lib/api";
import {
  CAMPAIGN_TOTALS_MAX_AGE_SECONDS,
  getCampaignTotals,
} from "@/lib/campaign";

export const dynamic = "force-dynamic";

/**
 * GET /api/campaign/summary
 *
 * Aggregates only. No names, no amounts belonging to any one person.
 * Held for 30 seconds, and invalidated immediately by any write that changes
 * the total.
 */
export async function GET() {
  try {
    const totals = await getCampaignTotals();

    return Response.json(totals, {
      headers: {
        "cache-control": `public, s-maxage=${CAMPAIGN_TOTALS_MAX_AGE_SECONDS}, stale-while-revalidate=60`,
      },
    });
  } catch (error) {
    return serviceProblem(error);
  }
}
