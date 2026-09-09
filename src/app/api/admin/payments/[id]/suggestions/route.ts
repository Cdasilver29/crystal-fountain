import { db } from "@/db";
import { getCurrentAdmin } from "@/lib/admin-context";
import { problem, serviceProblem } from "@/lib/api";
import { paymentPathParams } from "@/server/contracts/payments";
import * as payments from "@/server/services/payments";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/payments/:id/suggestions
 *
 * Likely pledges for this payment, best guess first. Any signed in admin,
 * including a viewer: a suggestion is a reading of data the viewer may already
 * see on the pledge list, and seeing what the system thinks is not the same as
 * acting on it.
 *
 * Read only, so no audit row. CLAUDE.md requires one for every admin write, and
 * this writes nothing.
 *
 * No phone number is returned even though the phone is one of the three things
 * matched on. The treasurer needs to know a phone matched, not what it is, and
 * the reason badge says that.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getCurrentAdmin();

  if (!admin) {
    return problem(401, "unauthorized", "Sign in to continue.");
  }

  const { id } = await params;
  const target = paymentPathParams.safeParse({ paymentId: id });

  if (!target.success) {
    return problem(404, "payment_not_found", "That payment does not exist.");
  }

  try {
    const suggestions = await payments.suggestMatches(db, {
      paymentId: target.data.paymentId,
    });

    return Response.json(
      {
        paymentId: target.data.paymentId,
        // Amounts always cross the wire as integer minor units, per PLAN.md
        // section 13.
        suggestions: suggestions.map((row) => ({
          pledgeId: row.pledgeId,
          reference: row.reference,
          fullName: row.fullName,
          amountMinor: row.amountMinor.toString(),
          paidMinor: row.paidMinor.toString(),
          outstandingMinor: row.outstandingMinor.toString(),
          status: row.status,
          matchReason: row.matchReason,
          confidence: row.confidence,
        })),
      },
      {
        // Balances move as the treasurer works. Nothing here should be held.
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    return serviceProblem(error);
  }
}
