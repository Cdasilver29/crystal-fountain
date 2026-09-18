import { revalidateTag } from "next/cache";

import { db } from "@/db";
import {
  clientIp,
  problem,
  serviceProblem,
  userAgent,
  validationProblem,
} from "@/lib/api";
import { CAMPAIGN_SLUG, CAMPAIGN_TOTALS_TAG } from "@/lib/campaign";
import { withdrawDisplayConsentInput } from "@/server/contracts/pledges";
import * as pledges from "@/server/services/pledges";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/redeem/display-consent
 *
 * Takes a pledger's name off the public list, immediately.
 *
 * DELETE rather than POST, because that is what it is: the thing being removed
 * is the consent, and the request body carries only enough to say whose. The
 * pair goes in the body and not in a query string, like the lookup beside it,
 * because a reference and a phone number in a URL end up in browser history
 * and in proxy logs.
 *
 * No approval, no queue and no administrator. Withdrawing consent has to be as
 * easy as giving it, and giving it was one unticked checkbox. Granting it is
 * still on the pledge form and is not reachable from here: taking a name off a
 * public page needs no gatekeeper, and putting one on it needs the person's
 * deliberate act.
 *
 * A miss is 200 with found false, not a 404, for the same reason the lookup
 * answers that way: saying which half of the pair was wrong would hand back
 * the fact that requiring both is there to protect.
 */
export async function DELETE(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return problem(400, "invalid_json", "That request body was not valid JSON.");
  }

  const parsed = withdrawDisplayConsentInput.safeParse(body);

  if (!parsed.success) {
    return validationProblem(parsed.error);
  }

  try {
    const result = await pledges.withdrawDisplayConsent(db, {
      input: parsed.data,
      campaignSlug: CAMPAIGN_SLUG,
      request: { ip: clientIp(request), userAgent: userAgent(request) },
    });

    /*
     * The home page band is cached under this tag and renders consented names,
     * so it has to be dropped or somebody who has just asked to be removed
     * would watch their own name drift past for another half minute. The
     * /pledgers list is force-dynamic and reads the database on every request,
     * so it needs nothing.
     *
     * Only when something actually changed. A second press changes nothing and
     * should not throw away a warm cache.
     */
    if (result.changed) {
      revalidateTag(CAMPAIGN_TOTALS_TAG);
    }

    return Response.json({
      found: result.found,
      changed: result.changed,
    });
  } catch (error) {
    return serviceProblem(error);
  }
}
