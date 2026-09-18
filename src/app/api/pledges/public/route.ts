import { db } from "@/db";
import { clientIp, serviceProblem, validationProblem } from "@/lib/api";
import { CAMPAIGN_SLUG } from "@/lib/campaign";
import {
  type PublicPledgersPage,
  publicPledgersQuery,
} from "@/server/contracts/public-pledgers";
import * as publicPledgers from "@/server/services/public-pledgers";

export const dynamic = "force-dynamic";

/**
 * GET /api/pledges/public?cursor=&q=
 *
 * Thin adapter: parse, call the service, format.
 *
 * The pages of /pledgers after the first. Public and unauthenticated, because
 * everything it can return has been consented to appearing on a public page in
 * exactly this form.
 *
 * GET with the search term in the query string, unlike the redeem lookup next
 * door, which is a POST precisely so a reference and a phone number stay out of
 * browser history. Nothing personal goes in this one: a term is whatever
 * somebody typed into a search box looking for their own first name, and the
 * response is a page of names already published on the page they typed it on.
 *
 * Rate limited at thirty a minute per address in the service, counted from the
 * database so the limit holds across instances and survives a redeploy.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);

  const parsed = publicPledgersQuery.safeParse({
    cursor: url.searchParams.get("cursor") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    return validationProblem(parsed.error);
  }

  try {
    const page = await publicPledgers.publicList(db, {
      campaignSlug: CAMPAIGN_SLUG,
      cursor: parsed.data.cursor,
      q: parsed.data.q,
      limit: parsed.data.limit,
      request: { ip: clientIp(request) },
    });

    const body: PublicPledgersPage = {
      entries: page.items,
      nextCursor: page.nextCursor,
    };

    /*
     * Never cached at the edge. The rate limit is counted per request in the
     * service, and a cached response is a request the limiter never sees.
     */
    return Response.json(body, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return serviceProblem(error);
  }
}
