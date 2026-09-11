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
import { campaignSettingsInput } from "@/server/contracts/campaign";
import * as campaign from "@/server/services/campaign";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/settings
 *
 * The super administrator's alone. These are the figures the whole public site
 * is measured against and the account numbers the congregation's money is sent
 * to, so they sit with one named person rather than with a role.
 *
 * The audit row is written inside the service, in the same transaction as the
 * change, and carries the before and after of every field that actually moved.
 */
export async function PATCH(request: Request) {
  const gate = await requirePermission(request, "settings.edit", {
    entity: "campaign",
  });
  if (!gate.ok) return gate.response;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return problem(400, "invalid_json", "That request body was not valid JSON.");
  }

  const parsed = campaignSettingsInput.safeParse(body);

  if (!parsed.success) {
    return validationProblem(parsed.error);
  }

  try {
    const result = await campaign.updateSettings(db, {
      campaignSlug: CAMPAIGN_SLUG,
      input: parsed.data,
      adminId: gate.admin.id,
      request: { ip: clientIp(request), userAgent: userAgent(request) },
    });

    /*
     * The target and the opening balance are inside v_campaign_totals, so
     * either one moves the figure on every public page and the cache has to go.
     * A changed paybill does not: it changes what the instructions say, not
     * what the tracker reads.
     */
    if (result.affectsTotals) {
      revalidateTag(CAMPAIGN_TOTALS_TAG);
    }

    return Response.json({ changed: result.changed });
  } catch (error) {
    return serviceProblem(error);
  }
}
