import { revalidateTag } from "next/cache";

import { db } from "@/db";
import {
  notifyPaymentChanges,
  notifySettingsChanged,
  refuseWithoutNotices,
} from "@/lib/admin-notices";
import { requirePermission } from "@/lib/admin-guard";
import {
  clientIp,
  problem,
  serviceProblem,
  userAgent,
  validationProblem,
} from "@/lib/api";
import { CAMPAIGN_SLUG, CAMPAIGN_TOTALS_TAG } from "@/lib/campaign";
import {
  campaignSettingsInput,
  PAYMENT_DETAIL_FIELDS,
} from "@/server/contracts/campaign";
import * as campaign from "@/server/services/campaign";
import * as paymentChanges from "@/server/services/payment-changes";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/settings
 *
 * The super administrator's alone. These are the figures the whole public site
 * is measured against and the account numbers the congregation's money is sent
 * to, so they sit with one named person rather than with a role.
 *
 * The audit row is written inside the service, in the same transaction as the
 * change, and carries the before and after of every field that actually moved.
 *
 * Payment details are the exception: a save that moves any of them is recorded
 * as a pending change for a different administrator to approve, and the site
 * keeps showing the current details until then. Every active administrator is
 * emailed about it at once, and about any other setting that changed, since
 * those are live the moment this returns.
 */
export async function PATCH(request: Request) {
  const gate = await requirePermission(request, "settings.edit", {
    entity: "campaign",
  });
  if (!gate.ok) return gate.response;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return problem(400, "invalid_json", "That request body was not valid JSON.");
  }

  const parsed = campaignSettingsInput.safeParse(body);

  if (!parsed.success) {
    return validationProblem(parsed.error);
  }

  // Everything but opening or closing the form has to be announced to happen.
  const mustAnnounce =
    PAYMENT_DETAIL_FIELDS.some((field) => parsed.data[field] !== undefined) ||
    parsed.data.targetKes !== undefined ||
    parsed.data.openingBalanceKes !== undefined ||
    parsed.data.autoApproveLimitKes !== undefined;

  if (mustAnnounce) {
    const refusal = refuseWithoutNotices();
    if (refusal) return refusal;
  }

  try {
    // A change past its seven days must not block a fresh request.
    notifyPaymentChanges(await paymentChanges.expireStale(db));

    const result = await campaign.updateSettings(db, {
      campaignSlug: CAMPAIGN_SLUG,
      input: parsed.data,
      adminId: gate.admin.id,
      request: { ip: clientIp(request), userAgent: userAgent(request) },
    });

    /*
     * The target and the opening balance are inside v_campaign_totals, so
     * either one moves the figure on every public page and the cache has to go.
     * A changed paybill does not: it changes what the instructions say, not
     * what the tracker reads.
     */
    if (result.affectsTotals) {
      revalidateTag(CAMPAIGN_TOTALS_TAG);
    }

    if (result.paymentChange) {
      notifyPaymentChanges([result.paymentChange]);
    }

    notifySettingsChanged({ moved: result.moved, changedByName: gate.admin.name });

    return Response.json({
      changed: result.changed,
      paymentChange: result.paymentChange
        ? {
            id: result.paymentChange.changeId,
            status: "pending",
            expiresAt: result.paymentChange.expiresAt.toISOString(),
          }
        : null,
    });
  } catch (error) {
    return serviceProblem(error);
  }
}
