import { db } from "@/db";
import { requirePermission } from "@/lib/admin-guard";
import { can } from "@/lib/permissions";
import { serviceProblem, validationProblem } from "@/lib/api";
import { CAMPAIGN_SLUG } from "@/lib/campaign";
import { pledgeSearchQuery } from "@/server/contracts/admin";
import * as pledges from "@/server/services/pledges";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/pledges/search?q=TERM
 *
 * Finds a pledge by reference, phone or name, for matching a payment to it.
 * Any signed in admin, including a viewer.
 *
 * Read only, so there is no audit row. CLAUDE.md requires one for every admin
 * write, and this writes nothing.
 *
 * A viewer gets masked phone numbers. The decision is made here, because roles
 * are a thing route handlers know about and services do not, but the masking
 * itself happens inside the service so no caller can forget to ask for it.
 */
export async function GET(request: Request) {
  const gate = await requirePermission(request, "pledges.view", {
    entity: "pledge",
  });
  if (!gate.ok) return gate.response;
  const admin = gate.admin;

  const { searchParams } = new URL(request.url);
  const parsed = pledgeSearchQuery.safeParse({ q: searchParams.get("q") ?? "" });

  if (!parsed.success) {
    return validationProblem(parsed.error);
  }

  try {
    const results = await pledges.search(db, {
      campaignSlug: CAMPAIGN_SLUG,
      q: parsed.data.q,
      revealPhone: can(admin, "pledges.viewPhone"),
    });

    return Response.json(
      {
        query: parsed.data.q,
        // Amounts always cross the wire as integer minor units with an
        // explicit currency, per PLAN.md section 13.
        results: results.map((row) => ({
          pledgeId: row.pledgeId,
          reference: row.reference,
          fullName: row.fullName,
          phone: row.phone,
          amountMinor: row.amountMinor.toString(),
          paidMinor: row.paidMinor.toString(),
          outstandingMinor: row.outstandingMinor.toString(),
          status: row.status,
          matchReason: row.matchReason,
        })),
      },
      {
        // A live lookup against a list the treasurer is actively changing.
        // Nothing about it should be held anywhere.
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    return serviceProblem(error);
  }
}
