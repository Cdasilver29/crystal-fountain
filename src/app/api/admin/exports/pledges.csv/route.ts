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
 * GET /api/admin/exports/pledges.csv
 *
 * Every pledge with its pledger's contact details. Treasurer and admin.
 *
 * This is the most sensitive thing the platform hands out, so a viewer is
 * refused and the refusal is recorded, and every successful download appends an
 * admin.export row inside the service naming who took it.
 *
 * No caching, anywhere. A file of the congregation's phone numbers must not sit
 * in a shared proxy or in the browser's disk cache for the next person on the
 * machine to find.
 */
export async function GET(request: Request) {
  const gate = await requirePermission(request, "exports.download", {
    entity: "pledges",
  });
  if (!gate.ok) return gate.response;
  const admin = gate.admin;

  try {
    await exports.assertCampaign(db, CAMPAIGN_SLUG);

    const result = await exports.pledges(db, {
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
