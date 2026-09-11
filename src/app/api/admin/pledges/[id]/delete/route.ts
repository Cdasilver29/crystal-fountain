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
  removePledgeInput,
} from "@/server/contracts/pledges";
import * as pledges from "@/server/services/pledges";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/pledges/:id/delete
 *
 * The super administrator's alone. Removing a pledge takes money off the figure
 * the congregation is watching, and that sits with one named person.
 *
 * POST rather than DELETE, because this deletes nothing: it sets deleted_at,
 * reverses any live allocation, and writes the whole pledge into the journal on
 * its way out. The row stays for good.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const target = approvePledgeInput.safeParse({ pledgeId: id });

  const gate = await requirePermission(request, "pledges.delete", {
    entity: "pledge",
    entityId: target.success ? target.data.pledgeId : null,
  });
  if (!gate.ok) return gate.response;

  if (!target.success) {
    return problem(404, "pledge_not_found", "That pledge does not exist.");
  }

  let body: unknown = {};

  try {
    body = await request.json();
  } catch {
    // A removal with no reason is allowed, so an empty body is not an error.
    body = {};
  }

  const parsed = removePledgeInput.safeParse(body);

  if (!parsed.success) {
    return validationProblem(parsed.error);
  }

  try {
    const result = await pledges.remove(db, {
      pledgeId: target.data.pledgeId,
      reason: parsed.data.reason ?? null,
      adminId: gate.admin.id,
      request: { ip: clientIp(request), userAgent: userAgent(request) },
    });

    if (result.affectsTotals) {
      revalidateTag(CAMPAIGN_TOTALS_TAG);
    }

    return Response.json({
      pledgeId: result.pledgeId,
      reference: result.reference,
      allocationsReversed: result.allocationsReversed,
    });
  } catch (error) {
    return serviceProblem(error);
  }
}
