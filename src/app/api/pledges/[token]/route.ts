import { db } from "@/db";
import { problem, serviceProblem } from "@/lib/api";
import { publicTokenInput } from "@/server/contracts/pledges";
import * as pledges from "@/server/services/pledges";

/**
 * GET /api/pledges/:publicToken
 *
 * Display safe fields only. No phone, no email, and the display name only if
 * the pledger consented to it. The service enforces that in its select list.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const parsed = publicTokenInput.safeParse({ publicToken: token });

  if (!parsed.success) {
    return problem(404, "pledge_not_found", "That pledge link is not valid.");
  }

  try {
    const pledge = await pledges.getByPublicToken(db, {
      publicToken: parsed.data.publicToken,
    });

    if (!pledge) {
      return problem(404, "pledge_not_found", "That pledge link is not valid.");
    }

    return Response.json(
      {
        reference: pledge.reference,
        amountMinor: pledge.amountMinor.toString(),
        currency: pledge.currency,
        status: pledge.status,
        intent: pledge.intent,
        createdAt: pledge.createdAt.toISOString(),
        displayName: pledge.displayName,
      },
      {
        // A pledge can be approved at any moment, so this must not be cached
        // at the edge.
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    return serviceProblem(error);
  }
}
