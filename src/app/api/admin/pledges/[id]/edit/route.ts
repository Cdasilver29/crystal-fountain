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
import { approvePledgeInput, editPledgeInput } from "@/server/contracts/pledges";
import * as pledges from "@/server/services/pledges";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/pledges/:id/edit
 *
 * Corrects a pledge. Admin role and above; a treasurer approves and records but
 * does not rewrite.
 *
 * Its own path rather than another action on the PATCH beside it, because the
 * two are different permissions doing different things: approving moves a
 * pledge through its lifecycle, editing changes what it says. Sharing a route
 * would mean one gate answering for both.
 *
 * The audit row and the adjustment increment are written inside the service, in
 * the same transaction as the change itself.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const target = approvePledgeInput.safeParse({ pledgeId: id });

  const gate = await requirePermission(request, "pledges.edit", {
    entity: "pledge",
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

  const parsed = editPledgeInput.safeParse(body);

  if (!parsed.success) {
    return validationProblem(parsed.error);
  }

  try {
    const result = await pledges.edit(db, {
      pledgeId: target.data.pledgeId,
      input: parsed.data,
      adminId: gate.admin.id,
      request: { ip: clientIp(request), userAgent: userAgent(request) },
    });

    /*
     * Only when the public figure actually moved. A correction to a pending
     * pledge changes nothing anybody can see, and throwing away a warm cache
     * for it would cost every visitor a query for no reason.
     */
    if (result.affectsTotals) {
      revalidateTag(CAMPAIGN_TOTALS_TAG);
    }

    return Response.json({
      pledgeId: result.pledgeId,
      reference: result.reference,
      changed: result.changed,
      amountMinor: result.amountMinor.toString(),
      status: result.status,
    });
  } catch (error) {
    return serviceProblem(error);
  }
}
