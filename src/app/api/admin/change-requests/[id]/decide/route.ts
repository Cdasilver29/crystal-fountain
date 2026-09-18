import { revalidateTag } from "next/cache";
import { z } from "zod";

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
import { can } from "@/lib/permissions";
import { decideChangeRequestInput } from "@/server/contracts/change-requests";
import { isServiceError } from "@/server/errors";
import * as adminAudit from "@/server/services/admin-audit";
import * as changeRequests from "@/server/services/change-requests";

export const dynamic = "force-dynamic";

const target = z.object({ requestId: z.uuid("That is not a request id.") });

/**
 * POST /api/admin/change-requests/:id/decide
 *
 * Approves or declines one request. One route rather than two, because the two
 * are the same permission answering the same question, and the body already
 * has to carry a note that only one of them requires. The contract is a union
 * on the decision, so a decline with no note cannot be expressed.
 *
 * Cancellation is the exception. Approving one takes a pledge off the figure
 * the congregation is watching, so it needs changeRequests.decideCancellation
 * on top. That cannot be checked here: which kind this is only becomes known
 * once the row is read, and reading it to decide what to check would be a
 * second query racing the one the service already does under a lock. So the
 * answer is passed in and the service refuses, and the refusal is recorded
 * here as an attempt, exactly as requirePermission would have done.
 *
 * The decision, the change it authorises and the audit row are all in one
 * transaction inside the service.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsedTarget = target.safeParse({ requestId: id });

  const gate = await requirePermission(request, "changeRequests.decide", {
    entity: "pledge_change_request",
    entityId: parsedTarget.success ? parsedTarget.data.requestId : null,
  });
  if (!gate.ok) return gate.response;

  if (!parsedTarget.success) {
    return problem(
      404,
      "change_request_not_found",
      "That request does not exist.",
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return problem(400, "invalid_json", "That request body was not valid JSON.");
  }

  const parsed = decideChangeRequestInput.safeParse(body);

  if (!parsed.success) {
    return validationProblem(parsed.error);
  }

  const { requestId } = parsedTarget.data;
  const context = {
    requestId,
    campaignSlug: CAMPAIGN_SLUG,
    input: parsed.data,
    adminId: gate.admin.id,
    canDecideCancellation: can(gate.admin, "changeRequests.decideCancellation"),
    request: { ip: clientIp(request), userAgent: userAgent(request) },
  };

  try {
    const result =
      parsed.data.decision === "approve"
        ? await changeRequests.approve(db, context)
        : await changeRequests.decline(db, context);

    /*
     * Only when something public actually moved. One tag covers the figure and
     * the feed, so an approved reduction and a corrected name on a consented
     * pledger both land here, and a decline does not.
     */
    if (result.revalidatePublic) {
      revalidateTag(CAMPAIGN_TOTALS_TAG);
    }

    return Response.json({
      requestId: result.requestId,
      pledgeId: result.pledgeId,
      reference: result.reference,
      kind: result.kind,
      status: result.status,
      /*
       * Where the treasurer goes next when a reported payment is approved.
       * Nothing is recorded by approving: see PaymentRouting in the service.
       * Minor units as a string, because JSON has no bigint.
       */
      payment: result.payment
        ? {
            paymentReference: result.payment.paymentReference,
            amountMinor: result.payment.amountMinor.toString(),
            paidOn: result.payment.paidOn,
            existingPaymentId: result.payment.existingPaymentId,
          }
        : null,
    });
  } catch (error) {
    /*
     * A treasurer reaching for a cancellation. The service refused it, and an
     * attempt at the one decision that is not theirs belongs in the journal
     * for the same reason every other refused attempt does.
     */
    if (isServiceError(error) && error.code === "cancellation_needs_admin") {
      await adminAudit.recordForbidden(db, {
        adminUserId: gate.admin.id,
        role: gate.admin.isSuper
          ? `${gate.admin.role} (super)`
          : gate.admin.role,
        attempted: "changeRequests.decideCancellation",
        entity: "pledge_change_request",
        entityId: requestId,
        ip: clientIp(request),
        userAgent: userAgent(request),
      });
    }

    return serviceProblem(error);
  }
}
