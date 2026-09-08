import { unstable_cache } from "next/cache";

import { db } from "@/db";
import { getTotals } from "@/server/services/campaign";

/**
 * Cached campaign totals.
 *
 * The figure is read from v_campaign_totals and then held for 30 seconds, so a
 * WhatsApp surge hitting the home page does not become a query per visitor. Any
 * write that changes the total revalidates CAMPAIGN_TOTALS_TAG, so an approval
 * shows up immediately rather than up to 30 seconds later.
 *
 * unstable_cache serialises its return value and bigint has no JSON
 * representation, so amounts cross this boundary as strings. They are still
 * exact minor units.
 */

export const CAMPAIGN_SLUG = "crystal-fountain";
export const CAMPAIGN_TOTALS_TAG = "campaign-totals";
export const CAMPAIGN_TOTALS_MAX_AGE_SECONDS = 30;

export type CampaignTotalsDto = {
  currency: string;
  targetMinor: string;
  pledgedMinor: string;
  receivedMinor: string;
  remainingMinor: string;
  percentPledged: number;
  percentReceived: number;
  pledgeCount: number;
  pledgerCount: number;
};

export const getCampaignTotals = unstable_cache(
  async (): Promise<CampaignTotalsDto> => {
    const totals = await getTotals(db, { campaignSlug: CAMPAIGN_SLUG });
    return {
      currency: totals.currency,
      targetMinor: totals.targetMinor.toString(),
      pledgedMinor: totals.pledgedMinor.toString(),
      receivedMinor: totals.receivedMinor.toString(),
      remainingMinor: totals.remainingMinor.toString(),
      percentPledged: totals.percentPledged,
      percentReceived: totals.percentReceived,
      pledgeCount: totals.pledgeCount,
      pledgerCount: totals.pledgerCount,
    };
  },
  [CAMPAIGN_TOTALS_TAG],
  { revalidate: CAMPAIGN_TOTALS_MAX_AGE_SECONDS, tags: [CAMPAIGN_TOTALS_TAG] },
);
