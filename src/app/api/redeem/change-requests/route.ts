import { db } from "@/db";
import {
  clientIp,
  problem,
  serviceProblem,
  userAgent,
  validationProblem,
} from "@/lib/api";
import { CAMPAIGN_SLUG } from "@/lib/campaign";
import { changeRequestInput } from "@/server/contracts/change-requests";
import * as changeRequests from "@/server/services/change-requests";

export const dynamic = "force-dynamic";

/**
 * POST /api/redeem/change-requests
 *
 * Records a request to change a pledge. Thin adapter: parse, call the service,
 * format.
 *
 * Nothing about the pledge moves here. The whole point of this feature is that
 * a pledger can ask and only an administrator can answer, so the most this
 * endpoint can do is write one row in one table and an audit entry beside it.
 *
 * The pair goes in the body rather than a query string, like the lookup and
 * the consent withdrawal beside it, because a reference and a phone number in
 * a URL end up in browser history and in proxy logs.
 *
 * No Turnstile, unlike the pledge form. The bot check is there because
 * recording a pledge moves a figure the congregation watches and anybody can
 * reach that form; this needs a reference and the phone number that matches
 * it, which a robot has no way to guess, and it is held by two rate limits
 * counted in the database on top of that. A widget here would cost every
 * pledger a puzzle to protect a row that changes nothing.
 *
 * An already open request is not an error and is not returned as one. Somebody
 * who submits twice, or comes back having forgotten, is shown the request they
 * already have rather than a refusal that tells them nothing about where the
 * first one went.
 */
export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return problem(400, "invalid_json", "That request body was not valid JSON.");
  }

  const parsed = changeRequestInput.safeParse(body);

  if (!parsed.success) {
    return validationProblem(parsed.error);
  }

  try {
    const result = await changeRequests.create(db, {
      input: parsed.data,
      campaignSlug: CAMPAIGN_SLUG,
      request: { ip: clientIp(request), userAgent: userAgent(request) },
    });

    /*
     * What goes back is what the page needs to show the pending state, and no
     * more. The reason is the pledger's own words and they have just typed
     * them; the decision note does not exist yet; and the contact number is
     * already theirs. Echoing any of it would put personal detail in a
     * response for no reason.
     */
    return Response.json(
      {
        outcome: result.outcome,
        request: {
          kind: result.request.kind,
          status: result.request.status,
          createdAt: result.request.createdAt.toISOString(),
        },
      },
      { status: result.outcome === "created" ? 201 : 200 },
    );
  } catch (error) {
    return serviceProblem(error);
  }
}
