import * as Sentry from "@sentry/nextjs";
import { revalidateTag } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { env } from "@/env";
import { requirePermission } from "@/lib/admin-guard";
import {
  clientIp,
  problem,
  serviceProblem,
  userAgent,
  validationProblem,
} from "@/lib/api";
import { CAMPAIGN_SLUG, CAMPAIGN_TOTALS_TAG } from "@/lib/campaign";
import { can } from "@/lib/permissions";
import { decideChangeRequestInput } from "@/server/contracts/change-requests";
import { isServiceError } from "@/server/errors";
import * as adminAudit from "@/server/services/admin-audit";
import * as changeRequests from "@/server/services/change-requests";
import { sendChangeRequestDecision } from "@/server/services/email";

export const dynamic = "force-dynamic";

const target = z.object({ requestId: z.uuid("That is not a request id.") });

/**
 * Tells the pledger what was decided, without the treasurer waiting for it.
 *
 * Scheduled with after(), like every other message this platform sends: the
 * decision is committed and the queue has already moved on by the time this
 * runs, so nothing in here can fail a decision.
 *
 * Most pledgers have no address on file, because the pledge form's email field
 * is optional and most leave it blank. That is why the queue card says so:
 * somebody has to ring them, and a silent skip with nothing on the screen
 * would mean nobody knew to.
 */
function tell(result: changeRequests.DecideChangeRequestResult) {
  if (!result.pledger.email) return;

  const task = async () => {
    const outcome = await sendChangeRequestDecision(
      { apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM_EMAIL },
      {
        to: result.pledger.email,
        decision: {
          fullName: result.pledger.name,
          reference: result.reference,
          change: result.request,
          decision: result.status,
          /*
           * The treasurer's own words on a decline, which the contract will
           * not let them skip. On an approval there is usually nothing to add
           * and the note is absent.
           */
          note: result.request.decisionNote ?? null,
          amountMinor: result.amountMinor,
          siteUrl: env.NEXT_PUBLIC_SITE_URL,
        },
      },
    );

    if (outcome.status === "failed") {
      Sentry.captureException(outcome.error, {
        tags: { area: "change_request_decision" },
        extra: { reference: result.reference, decision: result.status },
      });
    }
  };

  try {
    after(() => task().catch(() => {}));
  } catch {
    // A runtime with no request context must not turn a recorded decision
    // into a 500.
  }
}

/**
 * POST /api/admin/change-requests/:id/decide
 *
 * Approves or declines one request. One route rather than two, because the two
 * are the same permission answering the same question, and the body already
 * has to carry a note that only one of them requires. The contract is a union
 * on the decision, so a decline with no note cannot be expressed.
 *
 * Cancellation is the exception. Approving one takes a pledge off the figure
 * the congregation is watching, so it needs changeRequests.decideCancellation
 * on top. That cannot be checked here: which kind this is only becomes known
 * once the row is read, and reading it to decide what to check would be a
 * second query racing the one the service already does under a lock. So the
 * answer is passed in and the service refuses, and the refusal is recorded
 * here as an attempt, exactly as requirePermission would have done.
 *
 * The decision, the change it authorises and the audit row are all in one
 * transaction inside the service.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsedTarget = target.safeParse({ requestId: id });

  const gate = await requirePermission(request, "changeRequests.decide", {
    entity: "pledge_change_request",
    entityId: parsedTarget.success ? parsedTarget.data.requestId : null,
  });
  if (!gate.ok) return gate.response;

  if (!parsedTarget.success) {
    return problem(
      404,
      "change_request_not_found",
      "That request does not exist.",
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return problem(400, "invalid_json", "That request body was not valid JSON.");
  }

  const parsed = decideChangeRequestInput.safeParse(body);

  if (!parsed.success) {
    return validationProblem(parsed.error);
  }

  const { requestId } = parsedTarget.data;
  const context = {
    requestId,
    campaignSlug: CAMPAIGN_SLUG,
    input: parsed.data,
    adminId: gate.admin.id,
    canDecideCancellation: can(gate.admin, "changeRequests.decideCancellation"),
    request: { ip: clientIp(request), userAgent: userAgent(request) },
  };

  try {
    const result =
      parsed.data.decision === "approve"
        ? await changeRequests.approve(db, context)
        : await changeRequests.decline(db, context);

    /*
     * Only when something public actually moved. One tag covers the figure and
     * the feed, so an approved reduction and a corrected name on a consented
     * pledger both land here, and a decline does not.
     */
    if (result.revalidatePublic) {
      revalidateTag(CAMPAIGN_TOTALS_TAG);
    }

    tell(result);

    return Response.json({
      requestId: result.requestId,
      pledgeId: result.pledgeId,
      reference: result.reference,
      kind: result.kind,
      status: result.status,
      /*
       * Where the treasurer goes next when a reported payment is approved.
       * Nothing is recorded by approving: see PaymentRouting in the service.
       * Minor units as a string, because JSON has no bigint.
       */
      payment: result.payment
        ? {
            paymentReference: result.payment.paymentReference,
            amountMinor: result.payment.amountMinor.toString(),
            paidOn: result.payment.paidOn,
            existingPaymentId: result.payment.existingPaymentId,
          }
        : null,
    });
  } catch (error) {
    /*
     * A treasurer reaching for a cancellation. The service refused it, and an
     * attempt at the one decision that is not theirs belongs in the journal
     * for the same reason every other refused attempt does.
     */
    if (isServiceError(error) && error.code === "cancellation_needs_admin") {
      await adminAudit.recordForbidden(db, {
        adminUserId: gate.admin.id,
        role: gate.admin.isSuper
          ? `${gate.admin.role} (super)`
          : gate.admin.role,
        attempted: "changeRequests.decideCancellation",
        entity: "pledge_change_request",
        entityId: requestId,
        ip: clientIp(request),
        userAgent: userAgent(request),
      });
    }

    return serviceProblem(error);
  }
}
