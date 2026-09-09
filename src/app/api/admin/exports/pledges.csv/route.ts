import { db } from "@/db";
import { getCurrentAdmin, hasAtLeast } from "@/lib/admin-context";
import { clientIp, problem, serviceProblem, userAgent } from "@/lib/api";
import { CAMPAIGN_SLUG } from "@/lib/campaign";
import * as audit from "@/server/services/admin-audit";
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
  const admin = await getCurrentAdmin();

  if (!admin) {
    return problem(401, "unauthorized", "Sign in to continue.");
  }

  if (!hasAtLeast(admin, "treasurer")) {
    await audit.recordForbidden(db, {
      adminUserId: admin.id,
      role: admin.role,
      attempted: "export.pledges",
      entity: "pledges",
      entityId: null,
      ip: clientIp(request),
      userAgent: userAgent(request),
    });
    return problem(403, "forbidden", "Your account cannot export pledges.");
  }

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
