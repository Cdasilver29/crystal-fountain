import { db } from "@/db";
import {
  clientIp,
  problem,
  serviceProblem,
  userAgent,
  validationProblem,
} from "@/lib/api";
import { CAMPAIGN_SLUG } from "@/lib/campaign";
import { lookupPledgeInput } from "@/server/contracts/pledges";
import * as pledges from "@/server/services/pledges";

export const dynamic = "force-dynamic";

/**
 * POST /api/redeem/lookup
 *
 * Thin adapter: parse, call the service, format.
 *
 * POST rather than GET, even though this reads. A reference and a phone number
 * in a query string would be written into browser history, into proxy logs and
 * into anything that keeps a URL, and CLAUDE.md keeps personal detail out of
 * query strings.
 *
 * A miss is 200 with a null pledge, not a 404. The response says the same thing
 * whether the reference does not exist, exists under a different number, or was
 * mistyped, because telling those apart is exactly the fact that requiring both
 * fields is there to protect.
 */
export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return problem(400, "invalid_json", "That request body was not valid JSON.");
  }

  const parsed = lookupPledgeInput.safeParse(body);

  if (!parsed.success) {
    return validationProblem(parsed.error);
  }

  try {
    const pledge = await pledges.lookup(db, {
      input: parsed.data,
      campaignSlug: CAMPAIGN_SLUG,
      request: { ip: clientIp(request), userAgent: userAgent(request) },
    });

    if (!pledge) {
      return Response.json({ pledge: null }, { status: 200 });
    }

    return Response.json({
      pledge: {
        reference: pledge.reference,
        publicToken: pledge.publicToken,
        firstName: pledge.firstName,
        // Amounts always cross the wire as integer minor units.
        amountMinor: pledge.amountMinor.toString(),
        paidMinor: pledge.paidMinor.toString(),
        outstandingMinor: pledge.outstandingMinor.toString(),
        status: pledge.status,
        intent: pledge.intent,
        installmentFrequency: pledge.installmentFrequency,
        installmentAmountMinor:
          pledge.installmentAmountMinor?.toString() ?? null,
        createdAt: pledge.createdAt.toISOString(),
      },
    });
  } catch (error) {
    return serviceProblem(error);
  }
}
