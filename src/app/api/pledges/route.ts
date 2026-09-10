import { revalidateTag } from "next/cache";

import { db } from "@/db";
import {
  clientIp,
  problem,
  serviceProblem,
  userAgent,
  validationProblem,
} from "@/lib/api";
import { CAMPAIGN_SLUG, CAMPAIGN_TOTALS_TAG } from "@/lib/campaign";
import { env } from "@/env";
import { createPledgeInput } from "@/server/contracts/pledges";
import * as pledges from "@/server/services/pledges";
import { turnstileBypassAllowed } from "@/server/services/turnstile";

export const dynamic = "force-dynamic";

/**
 * POST /api/pledges
 *
 * Thin adapter: parse, call the service, format. Every field is validated here
 * with the same schema the form uses. Client validation is convenience only.
 *
 * A submission from a phone number that already has a live pledge adds to that
 * pledge rather than creating another one, so the reference and the public
 * token that come back are the ones the pledger already has. 200 rather than
 * 201 says so: nothing was created. The isAddition flag is what the form reads
 * to decide between telling somebody their pledge is recorded and telling them
 * it has been updated.
 *
 * This is the only place that knows where the Turnstile keys and the approval
 * limit come from. The service takes them as data, so the policy is testable
 * without an environment and stays portable if the API is split out later.
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
      security: {
        token: parsed.data.turnstileToken,
        keys: {
          siteKey: env.TURNSTILE_SITE_KEY,
          secretKey: env.TURNSTILE_SECRET_KEY,
        },
        bypassAllowed: turnstileBypassAllowed(process.env.NODE_ENV),
        autoApproveLimitKes: env.PLEDGE_AUTO_APPROVE_LIMIT_KES,
      },
    });

    /*
     * An auto approved pledge counts toward the public total the moment it is
     * recorded, so the cached totals are stale as soon as this returns and the
     * tracker would otherwise show the old figure for up to its max age. A
     * pledge left pending changes nothing anybody can see, and approval
     * revalidates for itself.
     */
    if (result.autoApproved) {
      revalidateTag(CAMPAIGN_TOTALS_TAG);
    }

    return Response.json(
      {
        reference: result.reference,
        publicToken: result.publicToken,
        // Amounts always cross the wire as integer minor units with an
        // explicit currency, per PLAN.md section 13.
        amountMinor: result.amountMinor.toString(),
        addedMinor: result.addedMinor.toString(),
        previousAmountMinor: result.previousAmountMinor?.toString() ?? null,
        isAddition: result.isAddition,
        currency: result.currency,
        status: result.status,
      },
      { status: result.isAddition ? 200 : 201 },
    );
  } catch (error) {
    return serviceProblem(error);
  }
}
