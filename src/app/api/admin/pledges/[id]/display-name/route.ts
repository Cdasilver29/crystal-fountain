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
import { CAMPAIGN_TOTALS_TAG } from "@/lib/campaign";
import {
  approvePledgeInput,
  setPublicDisplayNameInput,
} from "@/server/contracts/pledges";
import * as pledges from "@/server/services/pledges";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/pledges/:id/display-name
 *
 * Thin adapter: parse, call the service, format.
 *
 * Sets the name the pledger behind this pledge is published under, or resets
 * it to automatic with `{ "publicDisplayName": null }`. The record's full name
 * is not touched. A viewer is refused and the refusal recorded.
 *
 * Its own path beside /organisation rather than a field on it: the two are
 * separate decisions with separate permissions and separate audit rows.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const target = approvePledgeInput.safeParse({ pledgeId: id });

  const gate = await requirePermission(request, "pledgers.setDisplayName", {
    entity: "pledger",
    entityId: target.success ? target.data.pledgeId : null,
  });
  if (!gate.ok) return gate.response;

  if (!target.success) {
    return problem(404, "pledge_not_found", "That pledge does not exist.");
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return problem(400, "invalid_json", "That request body was not valid JSON.");
  }

  const parsed = setPublicDisplayNameInput.safeParse(body);

  if (!parsed.success) {
    return validationProblem(parsed.error);
  }

  try {
    const result = await pledges.setPublicDisplayName(db, {
      pledgeId: target.data.pledgeId,
      input: parsed.data,
      adminId: gate.admin.id,
      request: { ip: clientIp(request), userAgent: userAgent(request) },
    });

    // The feed and /pledgers both read through this tag, so the corrected name
    // appears on the next request rather than when the cache ages out.
    if (result.changed && result.affectsPublicList) {
      revalidateTag(CAMPAIGN_TOTALS_TAG);
    }

    return Response.json({
      pledgeId: result.pledgeId,
      pledgerId: result.pledgerId,
      reference: result.reference,
      publicDisplayName: result.publicDisplayName,
      shownAs: result.shownAs,
      changed: result.changed,
    });
  } catch (error) {
    return serviceProblem(error);
  }
}
