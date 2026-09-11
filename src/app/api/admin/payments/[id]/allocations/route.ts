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
  allocatePaymentInput,
  paymentPathParams,
} from "@/server/contracts/payments";
import * as payments from "@/server/services/payments";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/payments/:id/allocations
 *
 * Matches a payment, or part of one, to a pledge. Treasurer and admin.
 *
 * A thin adapter: parse, call the service, format. Every decision about what is
 * allowed, including the over allocation check, lives in payments.allocate and
 * runs inside its transaction.
 *
 * On the totals tag. Allocating does not in fact move v_campaign_totals:
 * received_minor sums payments regardless of allocation, and pledged_minor
 * already counts verified and fulfilled alike, so the fulfilled transition is a
 * no-op for it. The tag is invalidated anyway, because the cost is one dropped
 * cache entry and the alternative is a stale public figure the day somebody
 * changes how that view is defined.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const target = paymentPathParams.safeParse({ paymentId: id });

  // Roles are enforced here, on the server, not by hiding a button.
  const gate = await requirePermission(request, "payments.allocate", {
    entity: "payment",
    // Only a real uuid can go in an entity_id column.
    entityId: target.success ? target.data.paymentId : null,
  });
  if (!gate.ok) return gate.response;
  const admin = gate.admin;

  if (!target.success) {
    return problem(404, "payment_not_found", "That payment does not exist.");
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return problem(400, "invalid_json", "That request body was not valid JSON.");
  }

  const parsed = allocatePaymentInput.safeParse(body);

  if (!parsed.success) {
    return validationProblem(parsed.error);
  }

  try {
    const result = await payments.allocate(db, {
      paymentId: target.data.paymentId,
      input: parsed.data,
      adminId: admin.id,
      request: { ip: clientIp(request), userAgent: userAgent(request) },
    });

    revalidateTag(CAMPAIGN_TOTALS_TAG);

    return Response.json(
      {
        allocationId: result.allocationId,
        paymentId: result.paymentId,
        pledgeId: result.pledgeId,
        pledgeReference: result.pledgeReference,
        // Amounts always cross the wire as integer minor units with an
        // explicit currency, per PLAN.md section 13.
        amountMinor: result.amountMinor.toString(),
        currency: result.currency,
        allocatedAt: result.allocatedAt.toISOString(),
        payment: {
          amountMinor: result.paymentAmountMinor.toString(),
          allocatedMinor: result.paymentAllocatedMinor.toString(),
          unallocatedMinor: result.paymentUnallocatedMinor.toString(),
        },
        pledge: {
          amountMinor: result.pledgeAmountMinor.toString(),
          paidMinor: result.pledgePaidMinor.toString(),
          outstandingMinor: result.pledgeOutstandingMinor.toString(),
          status: result.pledgeStatus,
          fulfilled: result.pledgeFulfilled,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return serviceProblem(error);
  }
}
