import { revalidateTag } from "next/cache";

import { db } from "@/db";
import { getCurrentAdmin } from "@/lib/admin-context";
import { clientIp, problem, serviceProblem, userAgent } from "@/lib/api";
import { CAMPAIGN_TOTALS_TAG } from "@/lib/campaign";
import { allocationPathParams } from "@/server/contracts/payments";
import * as audit from "@/server/services/admin-audit";
import * as payments from "@/server/services/payments";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/admin/payments/:id/allocations/:allocationId
 *
 * Un-matches a payment from a pledge, for a correction.
 *
 * Admin only, and deliberately not treasurer. Making a match is routine work;
 * unmaking one changes a balance somebody may already have been told about, so
 * it sits one rank higher. A treasurer who needs a correction asks an admin,
 * and the refusal is recorded either way.
 *
 * DELETE is the verb because that is what the caller means. What actually
 * happens is a reversal, not a delete: the allocation row survives with
 * reversed_at set, per the corrections rule in CLAUDE.md. See
 * payments.deallocate.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; allocationId: string }> },
) {
  const admin = await getCurrentAdmin();

  if (!admin) {
    return problem(401, "unauthorized", "Sign in to continue.");
  }

  const { id, allocationId } = await params;
  const target = allocationPathParams.safeParse({
    paymentId: id,
    allocationId,
  });

  if (admin.role !== "admin") {
    await audit.recordForbidden(db, {
      adminUserId: admin.id,
      role: admin.role,
      attempted: "payment.deallocate",
      entity: "payment_allocation",
      entityId: target.success ? target.data.allocationId : null,
      ip: clientIp(request),
      userAgent: userAgent(request),
    });
    return problem(
      403,
      "forbidden",
      "Only an admin can remove an allocation. Ask one to make this correction.",
    );
  }

  if (!target.success) {
    return problem(
      404,
      "allocation_not_found",
      "That allocation does not exist.",
    );
  }

  try {
    const result = await payments.deallocate(db, {
      paymentId: target.data.paymentId,
      allocationId: target.data.allocationId,
      adminId: admin.id,
      request: { ip: clientIp(request), userAgent: userAgent(request) },
    });

    revalidateTag(CAMPAIGN_TOTALS_TAG);

    return Response.json({
      allocationId: result.allocationId,
      paymentId: result.paymentId,
      pledgeId: result.pledgeId,
      pledgeReference: result.pledgeReference,
      amountMinor: result.amountMinor.toString(),
      currency: result.currency,
      reversedAt: result.reversedAt.toISOString(),
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
        reverted: result.pledgeReverted,
      },
    });
  } catch (error) {
    return serviceProblem(error);
  }
}
