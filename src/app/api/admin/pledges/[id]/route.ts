import { revalidateTag } from "next/cache";

import { db } from "@/db";
import { clientIp, problem, serviceProblem, userAgent, validationProblem } from "@/lib/api";
import { requirePermission } from "@/lib/admin-guard";
import { CAMPAIGN_TOTALS_TAG } from "@/lib/campaign";
import { adminPledgeActionInput } from "@/server/contracts/admin";
import { approvePledgeInput } from "@/server/contracts/pledges";
import * as pledges from "@/server/services/pledges";

export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH /api/admin/pledges/:id
 *
 * Approving is what makes a pledge count toward the public total, so the
 * campaign totals tag is invalidated on success. Without that the figure would
 * lag by up to the 30 second cache window and the treasurer would think the
 * approval had not worked.
 *
 * The audit row is written inside the service, in the same transaction as the
 * status change.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Roles are enforced here, on the server, not by hiding a button. A viewer
  // can read the pledge list and nothing more.
  const { id: targetId } = await params;
  const gate = await requirePermission(request, "pledges.approve", {
    entity: "pledge",
    // Only a real uuid can go in an entity_id column.
    entityId: UUID.test(targetId) ? targetId : null,
  });
  if (!gate.ok) return gate.response;
  const admin = gate.admin;

  const { id } = await params;
  const target = approvePledgeInput.safeParse({ pledgeId: id });

  if (!target.success) {
    return problem(404, "pledge_not_found", "That pledge does not exist.");
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return problem(400, "invalid_json", "That request body was not valid JSON.");
  }

  const parsed = adminPledgeActionInput.safeParse(body);

  if (!parsed.success) {
    return validationProblem(parsed.error);
  }

  try {
    const result = await pledges.approve(db, {
      pledgeId: target.data.pledgeId,
      // Now that admins are real people rather than one shared secret, the
      // approval carries who made it. The service writes it into the audit row
      // in the same transaction as the status change.
      adminId: admin.id,
      request: { ip: clientIp(request), userAgent: userAgent(request) },
    });

    revalidateTag(CAMPAIGN_TOTALS_TAG);

    return Response.json({
      pledgeId: result.pledgeId,
      reference: result.reference,
      status: result.status,
      verifiedAt: result.verifiedAt?.toISOString() ?? null,
    });
  } catch (error) {
    return serviceProblem(error);
  }
}
