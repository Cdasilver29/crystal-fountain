import { db } from "@/db";
import { clientIp, problem, serviceProblem, userAgent, validationProblem } from "@/lib/api";
import { CAMPAIGN_SLUG } from "@/lib/campaign";
import { createPledgeInput } from "@/server/contracts/pledges";
import * as pledges from "@/server/services/pledges";

export const dynamic = "force-dynamic";

/**
 * POST /api/pledges
 *
 * Thin adapter: parse, call the service, format. Every field is validated here
 * with the same schema the form uses. Client validation is convenience only.
 *
 * A new pledge is pending and does not count toward the public total, so this
 * route does not revalidate the campaign totals cache. Approval does.
 */
export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return problem(400, "invalid_json", "That request body was not valid JSON.");
  }

  const parsed = createPledgeInput.safeParse(body);

  if (!parsed.success) {
    return validationProblem(parsed.error);
  }

  try {
    const result = await pledges.create(db, {
      input: parsed.data,
      campaignSlug: CAMPAIGN_SLUG,
      channel: "web",
      request: { ip: clientIp(request), userAgent: userAgent(request) },
    });

    return Response.json(
      {
        reference: result.reference,
        publicToken: result.publicToken,
        // Amounts always cross the wire as integer minor units with an
        // explicit currency, per PLAN.md section 13.
        amountMinor: result.amountMinor.toString(),
        currency: result.currency,
        status: result.status,
      },
      { status: 201 },
    );
  } catch (error) {
    return serviceProblem(error);
  }
}
