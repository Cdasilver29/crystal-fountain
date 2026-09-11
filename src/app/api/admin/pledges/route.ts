import { revalidateTag } from "next/cache";

import { db } from "@/db";
import { requirePermission } from "@/lib/admin-guard";
import {
  clientIp,
  problem,
  serviceProblem,
  userAgent,
  validationProblem,
} from "@/lib/api";
import { CAMPAIGN_SLUG, CAMPAIGN_TOTALS_TAG } from "@/lib/campaign";
import { adminCreatePledgeInput } from "@/server/contracts/pledges";
import * as pledges from "@/server/services/pledges";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/pledges
 *
 * Records a pledge somebody made on paper or over the phone. Treasurer and
 * above: this is the treasurer's daily work, not an administrative act.
 *
 * Verified on entry, so it counts immediately and the campaign totals tag is
 * always invalidated. There is no Turnstile here and no auto approve limit: a
 * person typing at a keyboard is the check those two exist to approximate.
 */
export async function POST(request: Request) {
  const gate = await requirePermission(request, "pledges.create", {
    entity: "pledge",
  });
  if (!gate.ok) return gate.response;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return problem(400, "invalid_json", "That request body was not valid JSON.");
  }

  const parsed = adminCreatePledgeInput.safeParse(body);

  if (!parsed.success) {
    return validationProblem(parsed.error);
  }

  try {
    const result = await pledges.createByAdmin(db, {
      input: parsed.data,
      campaignSlug: CAMPAIGN_SLUG,
      adminId: gate.admin.id,
      request: { ip: clientIp(request), userAgent: userAgent(request) },
    });

    revalidateTag(CAMPAIGN_TOTALS_TAG);

    return Response.json(
      {
        pledgeId: result.pledgeId,
        reference: result.reference,
        amountMinor: result.amountMinor.toString(),
        addedMinor: result.addedMinor.toString(),
        isAddition: result.isAddition,
        status: result.status,
      },
      { status: result.isAddition ? 200 : 201 },
    );
  } catch (error) {
    return serviceProblem(error);
  }
}
