import { sql } from "drizzle-orm";

import type { Db } from "@/db";
import { notFound } from "@/server/errors";
import { percentOf } from "@/server/money";

/**
 * Campaign services.
 *
 * Totals are read from v_campaign_totals, which is the only place they come
 * from. Never a counter column, never a constant, never config.
 */

export type CampaignTotals = {
  currency: string;
  targetMinor: bigint;
  pledgedMinor: bigint;
  receivedMinor: bigint;
  /** Target less pledged, floored at zero once the campaign is oversubscribed. */
  remainingMinor: bigint;
  percentPledged: number;
  percentReceived: number;
  /**
   * Received as a share of pledged, not of the target.
   *
   * How much of what was promised has actually arrived, which is a different
   * question from how far the campaign has got and the one the congregation
   * asks second. Zero while nothing has been pledged, because a share of
   * nothing is not a hundred percent.
   */
  percentRedeemed: number;
  pledgeCount: number;
  pledgerCount: number;
};

type TotalsRow = {
  currency: string;
  target_minor: string;
  pledged_minor: string;
  received_minor: string;
  pledge_count: string;
  pledger_count: string;
};

/**
 * Live campaign totals.
 *
 * The driver hands bigint columns back as strings, which is what we want:
 * they become BigInt here without ever passing through a JavaScript number.
 * All the arithmetic is integer arithmetic on minor units, and the only
 * rounding happens once, when the two percentages are produced.
 */
export async function getTotals(
  db: Db,
  args: { campaignSlug: string },
): Promise<CampaignTotals> {
  const result = await db.execute(sql`
    select c.currency,
           t.target_minor,
           t.pledged_minor,
           t.received_minor,
           t.pledge_count,
           t.pledger_count
    from v_campaign_totals t
    join campaigns c on c.id = t.campaign_id
    where c.slug = ${args.campaignSlug}
    limit 1
  `);

  const row = result.rows[0] as TotalsRow | undefined;

  if (!row) {
    throw notFound(
      "campaign_not_found",
      `No campaign with slug ${args.campaignSlug}.`,
    );
  }

  const targetMinor = BigInt(row.target_minor);
  const pledgedMinor = BigInt(row.pledged_minor);
  const receivedMinor = BigInt(row.received_minor);

  return {
    currency: row.currency,
    targetMinor,
    pledgedMinor,
    receivedMinor,
    remainingMinor:
      targetMinor > pledgedMinor ? targetMinor - pledgedMinor : 0n,
    percentPledged: percentOf(pledgedMinor, targetMinor),
    percentReceived: percentOf(receivedMinor, targetMinor),
    percentRedeemed: percentOf(receivedMinor, pledgedMinor),
    // Counts, not money, so a number is the right type here.
    pledgeCount: Number(row.pledge_count),
    pledgerCount: Number(row.pledger_count),
  };
}
