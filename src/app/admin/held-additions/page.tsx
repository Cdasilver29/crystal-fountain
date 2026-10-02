import type { Metadata } from "next";
import { forbidden, redirect } from "next/navigation";

import { AdminNav } from "@/components/admin/admin-nav";
import { HeldAdditionQueue } from "@/components/admin/held-addition-queue";
import { db } from "@/db";
import { heldAdditionCount, pendingChangeRequestCount } from "@/lib/admin-badges";
import { getCurrentAdmin } from "@/lib/admin-context";
import { CAMPAIGN_SLUG } from "@/lib/campaign";
import { can } from "@/lib/permissions";
import * as heldAdditions from "@/server/services/held-additions";

export const metadata: Metadata = {
  title: "Held additions",
  robots: { index: false, follow: false },
};

// Reads a cookie, so it can never be prerendered.
export const dynamic = "force-dynamic";

/**
 * Additions held for the treasurer to confirm with the pledger.
 *
 * A phone number can be known by anybody and a shared pledge link is
 * forwarded by design, so an addition from a browser that did not make the
 * pledge moves nothing until somebody rings the pledger. Every role may read
 * the queue; the buttons are the treasurer's.
 */
export default async function AdminHeldAdditionsPage() {
  const admin = await getCurrentAdmin();

  if (!admin) redirect("/admin/login?next=/admin/held-additions");

  // A temporary password is still somebody else's. Nothing opens until it has
  // been changed.
  if (admin.mustChangePassword) redirect("/admin/change-password");

  if (!can(admin, "pledges.view")) forbidden();

  const rows = await heldAdditions.listHeld(db, {
    campaignSlug: CAMPAIGN_SLUG,
    // The treasurer rings this number, so they see it whole. A viewer has no
    // call to make and sees the last three digits, masked by the service.
    revealPhone: can(admin, "pledges.viewPhone"),
  });

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-50">
      <header className="bg-navy page-gutter py-5">
        <div className="container-table">
          <AdminNav
            name={admin.name}
            role={admin.role}
            isSuper={admin.isSuper}
            pendingChangeRequests={await pendingChangeRequestCount(admin)}
            heldAdditions={await heldAdditionCount(admin)}
          />
        </div>
      </header>

      <main className="page-gutter py-8 pb-16">
        <div className="container-table">
          <h1 className="text-2xl font-semibold tracking-tight text-navy">
            Held additions
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-600">
            Additions to a pledge that came from a browser that did not make
            it. None of them counts toward the pledge or the public total until
            you confirm it with the pledger. Rejecting leaves the pledge as it
            is.
          </p>

          <div className="container-form mx-0">
            <HeldAdditionQueue
              canDecide={can(admin, "pledges.confirmAddition")}
              rows={rows.map((row) => ({
                incrementId: row.incrementId,
                pledgeId: row.pledgeId,
                reference: row.reference,
                pledgerName: row.pledgerName,
                phoneOnRecord: row.phoneOnRecord,
                // Minor units cross to the client as strings. Still exact.
                addedMinor: row.addedMinor.toString(),
                currentAmountMinor: row.currentAmountMinor.toString(),
                createdAt: row.createdAt.toISOString(),
              }))}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
