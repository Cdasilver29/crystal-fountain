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
  setOrganisationInput,
} from "@/server/contracts/pledges";
import * as pledges from "@/server/services/pledges";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/pledges/:id/organisation
 *
 * Thin adapter: parse, call the service, format.
 *
 * Marks the pledger behind this pledge an organisation, or unmarks them. The
 * treasurer decides, because the treasurer is the one who knows which names are
 * funds and which are families. A viewer is refused and the refusal is recorded,
 * like every other refusal in the portal.
 *
 * Its own path rather than another field on the edit route next door. Editing a
 * pledge is an admin action that rewrites what a pledge says; this is a
 * treasurer action that changes how a name is rendered. Sharing a route would
 * mean one permission gate answering for two different questions.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const target = approvePledgeInput.safeParse({ pledgeId: id });

  const gate = await requirePermission(request, "pledgers.setOrganisation", {
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

  const parsed = setOrganisationInput.safeParse(body);

  if (!parsed.success) {
    return validationProblem(parsed.error);
  }

  try {
    const result = await pledges.setOrganisation(db, {
      pledgeId: target.data.pledgeId,
      input: parsed.data,
      adminId: gate.admin.id,
      request: { ip: clientIp(request), userAgent: userAgent(request) },
    });

    /*
     * Only when a name the public can actually see just changed. The feed and
     * /pledgers both read through this tag, so this is what makes the corrected
     * name appear without waiting for the cache to age out.
     */
    if (result.changed && result.affectsPublicList) {
      revalidateTag(CAMPAIGN_TOTALS_TAG);
    }

    return Response.json({
      pledgeId: result.pledgeId,
      pledgerId: result.pledgerId,
      reference: result.reference,
      isOrganisation: result.isOrganisation,
      changed: result.changed,
    });
  } catch (error) {
    return serviceProblem(error);
  }
}
