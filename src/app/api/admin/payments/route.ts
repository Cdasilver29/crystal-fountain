import { revalidateTag } from "next/cache";

import { db } from "@/db";
import { getCurrentAdmin, hasAtLeast } from "@/lib/admin-context";
import {
  clientIp,
  problem,
  serviceProblem,
  userAgent,
  validationProblem,
} from "@/lib/api";
import { CAMPAIGN_SLUG, CAMPAIGN_TOTALS_TAG } from "@/lib/campaign";
import { recordPaymentInput } from "@/server/contracts/payments";
import * as audit from "@/server/services/admin-audit";
import * as payments from "@/server/services/payments";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/payments
 *
 * Records a payment the treasurer has seen arrive.
 *
 * v_campaign_totals counts every received payment toward the public figure, so
 * this invalidates the campaign totals tag on success. Without that the home
 * page would lag by up to the 30 second cache window and the treasurer would
 * think the entry had not worked.
 */
export async function POST(request: Request) {
  const admin = await getCurrentAdmin();

  if (!admin) {
    return problem(401, "unauthorized", "Sign in to continue.");
  }

  if (!hasAtLeast(admin, "treasurer")) {
    await audit.recordForbidden(db, {
      adminUserId: admin.id,
      role: admin.role,
      attempted: "payment.record",
      entity: "payment",
      entityId: null,
      ip: clientIp(request),
      userAgent: userAgent(request),
    });
    return problem(403, "forbidden", "Your account cannot record payments.");
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return problem(400, "invalid_json", "That request body was not valid JSON.");
  }

  const parsed = recordPaymentInput.safeParse(body);

  if (!parsed.success) {
    return validationProblem(parsed.error);
  }

  try {
    const result = await payments.record(db, {
      input: parsed.data,
      campaignSlug: CAMPAIGN_SLUG,
      adminId: admin.id,
      request: { ip: clientIp(request), userAgent: userAgent(request) },
    });

    revalidateTag(CAMPAIGN_TOTALS_TAG);

    return Response.json(
      {
        paymentId: result.paymentId,
        // Amounts always cross the wire as integer minor units with an
        // explicit currency, per PLAN.md section 13.
        amountMinor: result.amountMinor.toString(),
        currency: result.currency,
        status: result.status,
        paidAt: result.paidAt.toISOString(),
      },
      { status: 201 },
    );
  } catch (error) {
    return serviceProblem(error);
  }
}
