import * as Sentry from "@sentry/nextjs";
import { revalidateTag } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { requirePermission } from "@/lib/admin-guard";
import {
  clientIp,
  problem,
  serviceProblem,
  userAgent,
  validationProblem,
} from "@/lib/api";
import { CAMPAIGN_TOTALS_TAG } from "@/lib/campaign";
import { env } from "@/env";
import { renderAdditionConfirmed } from "@/server/email/held-addition";
import { sendRendered } from "@/server/services/email";
import { decideHeldAdditionInput } from "@/server/contracts/pledges";
import * as heldAdditions from "@/server/services/held-additions";
import { refuseCrossSite } from "@/lib/site-hosts";
import { emailConfig } from "@/lib/email-config";

export const dynamic = "force-dynamic";

const target = z.object({ incrementId: z.string().regex(/^\d{1,18}$/) });

/**
 * POST /api/admin/held-additions/:id
 *
 * Confirms or rejects an addition held because it came from a browser that
 * did not make the pledge. A confirmation is emailed to the pledger at the
 * address on their record. Confirming needs the treasurer to say how they
 * confirmed it with the pledger, and the contract refuses one without. The
 * decision, the money and the audit rows are one transaction in the service.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const crossSite = refuseCrossSite(request);
  if (crossSite) return crossSite;

  const { id } = await params;
  const parsedTarget = target.safeParse({ incrementId: id });

  const gate = await requirePermission(request, "pledges.confirmAddition", {
    entity: "pledge_increment",
  });
  if (!gate.ok) return gate.response;

  if (!parsedTarget.success) {
    return problem(404, "held_addition_not_found", "That addition does not exist.");
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return problem(400, "invalid_json", "That request body was not valid JSON.");
  }

  const parsed = decideHeldAdditionInput.safeParse(body);

  if (!parsed.success) return validationProblem(parsed.error);

  try {
    const result = await heldAdditions.decide(db, {
      incrementId: parsedTarget.data.incrementId,
      input: parsed.data,
      adminId: gate.admin.id,
      request: { ip: clientIp(request), userAgent: userAgent(request) },
    });

    if (result.revalidatePublic) revalidateTag(CAMPAIGN_TOTALS_TAG);

    // The pledger hears that it is confirmed, at the address on their record.
    if (result.status === "confirmed" && result.pledger.email) {
      const to = result.pledger.email;
      const task = async () => {
        const outcome = await sendRendered(
          emailConfig(),
          {
            to,
            message: renderAdditionConfirmed({
              fullName: result.pledger.fullName,
              reference: result.reference,
              addedMinor: result.addedMinor,
              totalMinor: result.totalMinor,
              siteUrl: env.NEXT_PUBLIC_SITE_URL,
            }),
            tag: "addition_confirmed",
          },
        );
        if (outcome.status === "failed") {
          Sentry.captureException(outcome.error, {
            tags: { area: "held_addition_email" },
            extra: { reference: result.reference },
          });
        }
      };
      try {
        after(() => task().catch(() => {}));
      } catch {
        void task().catch(() => {});
      }
    }

    return Response.json({
      incrementId: result.incrementId,
      reference: result.reference,
      status: result.status,
    });
  } catch (error) {
    return serviceProblem(error);
  }
}
