import { db } from "@/db";
import type { CurrentAdmin } from "@/lib/admin-context";
import { CAMPAIGN_SLUG } from "@/lib/campaign";
import { can } from "@/lib/permissions";
import * as changeRequests from "@/server/services/change-requests";

/**
 * The numbers the nav carries.
 *
 * One function, called by every admin page, because there is no admin layout:
 * each page renders AdminNav itself, so each one has to supply this. A helper
 * rather than the query inlined eleven times means the rule about who may see
 * the count lives in one place, and a page added later has one line to copy
 * rather than five.
 *
 * Not cached. The campaign totals are, because they are on the public home
 * page under load; this is one indexed count read by a handful of
 * administrators, and a badge that is thirty seconds stale is a badge that
 * tells a treasurer there is nothing waiting when there is.
 */

/**
 * How many change requests are waiting, or zero for somebody who may not see
 * the queue at all.
 *
 * Zero rather than null, so the nav has nothing to decide: a role with no
 * business knowing the number is given a number that shows no badge, and the
 * link itself is already filtered out of the nav for them.
 */
export async function pendingChangeRequestCount(
  admin: Pick<CurrentAdmin, "role" | "isSuper">,
): Promise<number> {
  if (!can(admin, "changeRequests.view")) return 0;

  return changeRequests.countPending(db, { campaignSlug: CAMPAIGN_SLUG });
}
