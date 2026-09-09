import { db } from "@/db";
import { getCurrentAdmin, hasAtLeast } from "@/lib/admin-context";
import { clientIp, problem, serviceProblem, userAgent } from "@/lib/api";
import { CAMPAIGN_SLUG } from "@/lib/campaign";
import * as audit from "@/server/services/admin-audit";
import * as exports from "@/server/services/exports";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/exports/payments.csv
 *
 * The payment book, with how much of each payment has found a pledge.
 * Treasurer and admin.
 *
 * The allocation status is derived in the same way the payment list derives it,
 * so this file and that screen cannot disagree about a payment.
 *
 * Same handling as the pledge export: a viewer is refused and the refusal is
 * recorded, the download appends an admin.export row, and nothing is cached.
 */
export async function GET(request: Request) {
  const admin = await getCurrentAdmin();

  if (!admin) {
    return problem(401, "unauthorized", "Sign in to continue.");
  }

  if (!hasAtLeast(admin, "treasurer")) {
    await audit.recordForbidden(db, {
      adminUserId: admin.id,
      role: admin.role,
      attempted: "export.payments",
      entity: "payments",
      entityId: null,
      ip: clientIp(request),
      userAgent: userAgent(request),
    });
    return problem(403, "forbidden", "Your account cannot export payments.");
  }

  try {
    await exports.assertCampaign(db, CAMPAIGN_SLUG);

    const result = await exports.payments(db, {
      campaignSlug: CAMPAIGN_SLUG,
      adminId: admin.id,
      request: { ip: clientIp(request), userAgent: userAgent(request) },
    });

    return new Response(result.csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${result.filename}"`,
        "cache-control": "no-store, private",
      },
    });
  } catch (error) {
    return serviceProblem(error);
  }
}
