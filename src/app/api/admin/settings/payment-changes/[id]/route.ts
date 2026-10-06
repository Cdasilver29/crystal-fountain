import { z } from "zod";

import { db } from "@/db";
import { requirePermission } from "@/lib/admin-guard";
import { getCurrentAdmin } from "@/lib/admin-context";
import { notifyPaymentChanges, refuseWithoutNotices } from "@/lib/admin-notices";
import {
  clientIp,
  problem,
  serviceProblem,
  userAgent,
  validationProblem,
} from "@/lib/api";
import { can } from "@/lib/permissions";
import { decidePaymentChangeInput } from "@/server/contracts/campaign";
import * as paymentChanges from "@/server/services/payment-changes";
import { refuseCrossSite } from "@/lib/site-hosts";

export const dynamic = "force-dynamic";

const target = z.object({ changeId: z.uuid("That is not a change id.") });

/**
 * POST /api/admin/settings/payment-changes/:id
 *
 * The second signature on a change to where members' money is sent.
 *
 * Approving needs settings.approvePaymentChange, which an administrator holds
 * and the super administrator, who asks, cannot use on their own request: the
 * service refuses the requester and so does the database. Rejecting is open to
 * the same people and also to the requester, so a mistaken request can be
 * withdrawn.
 *
 * Every active administrator is emailed the outcome at once.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const crossSite = refuseCrossSite(request);
  if (crossSite) return crossSite;

  /*
   * Who is asking, before what they asked. The role is settled by the gate
   * below once the decision is known, but a caller with no session is turned
   * away here, so a stranger is never walked through what this body expects.
   */
  const viewer = await getCurrentAdmin();
  if (!viewer) return problem(401, "unauthenticated", "Sign in to continue.");

  const { id } = await params;
  const ids = target.safeParse({ changeId: id });

  if (!ids.success) return validationProblem(ids.error);

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return problem(400, "invalid_json", "That request body was not valid JSON.");
  }

  const parsed = decidePaymentChangeInput.safeParse(body);

  if (!parsed.success) return validationProblem(parsed.error);

  const { decision } = parsed.data;

  // Withdrawing a request is the requester's right as well, and they hold
  // settings.edit rather than the approval right.
  const action =
    decision === "reject" &&
    !can(viewer, "settings.approvePaymentChange") &&
    can(viewer, "settings.edit")
      ? "settings.edit"
      : "settings.approvePaymentChange";

  const gate = await requirePermission(request, action, {
    entity: "campaign",
  });
  if (!gate.ok) return gate.response;

  if (decision === "approve") {
    const refusal = refuseWithoutNotices();
    if (refusal) return refusal;
  }

  try {
    notifyPaymentChanges(await paymentChanges.expireStale(db));

    const notice = await paymentChanges.decide(db, {
      changeId: ids.data.changeId,
      decision,
      adminId: gate.admin.id,
      request: { ip: clientIp(request), userAgent: userAgent(request) },
    });

    notifyPaymentChanges([notice]);

    return Response.json({ id: notice.changeId, status: notice.event });
  } catch (error) {
    return serviceProblem(error);
  }
}
