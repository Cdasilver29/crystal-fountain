import { db } from "@/db";
import { requirePermission } from "@/lib/admin-guard";
import {
  clientIp,
  serviceProblem,
  userAgent,
} from "@/lib/api";
import { CAMPAIGN_SLUG } from "@/lib/campaign";
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
  const gate = await requirePermission(request, "exports.download", {
    entity: "payments",
  });
  if (!gate.ok) return gate.response;
  const admin = gate.admin;

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
