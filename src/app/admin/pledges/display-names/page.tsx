import type { Metadata } from "next";
import Link from "next/link";
import { forbidden, redirect } from "next/navigation";

import { AdminNav } from "@/components/admin/admin-nav";
import { DisplayNameReview } from "@/components/admin/display-name-review";
import { db } from "@/db";
import { pendingChangeRequestCount } from "@/lib/admin-badges";
import { getCurrentAdmin } from "@/lib/admin-context";
import { CAMPAIGN_SLUG } from "@/lib/campaign";
import { can } from "@/lib/permissions";
import * as pledges from "@/server/services/pledges";

export const metadata: Metadata = {
  title: "Review public names",
  robots: { index: false, follow: false },
};

// Reads a cookie, so it can never be prerendered.
export const dynamic = "force-dynamic";

/**
 * Every consented pledger's public name on one screen, for the treasurer to
 * work down once and fix what the automatic rule gets wrong.
 *
 * Treasurer and admin only, the same permission as the edit control on the
 * pledge screen. A viewer gets a 403. No admin.forbidden row is written for
 * the refused render, as on the change request screen: opening a page is a
 * read, and the route behind each save is what records an actual attempt.
 *
 * Every save goes through PATCH /api/admin/pledges/:id/display-name and so
 * through setPublicDisplayName, which writes one audit row per change.
 */
export default async function AdminDisplayNamesPage() {
  const admin = await getCurrentAdmin();

  if (!admin) redirect("/admin/login?next=/admin/pledges/display-names");

  // A temporary password is still somebody else's. Nothing opens until it
  // has been changed.
  if (admin.mustChangePassword) redirect("/admin/change-password");

  if (!can(admin, "pledgers.setDisplayName")) forbidden();

  const rows = await pledges.listPublicNamesForReview(db, {
    campaignSlug: CAMPAIGN_SLUG,
  });

  return (
    <div className="flex flex-1 flex-col bg-neutral-50">
      <header className="bg-navy page-gutter py-8">
        <div className="container-table">
          <AdminNav
            name={admin.name}
            role={admin.role}
            isSuper={admin.isSuper}
            pendingChangeRequests={await pendingChangeRequestCount(admin)}
          />

          <p className="mt-6 text-sm text-white/70">
            <Link
              href="/admin/pledges"
              className="rounded underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
            >
              Pledges
            </Link>
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">
            Review public names
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-white/80">
            What each pledger who agreed to be shown appears as on the website.
            Correct a name and press Enter to save it and move to the next row.
            The full name on the record does not change.
          </p>
        </div>
      </header>

      <main className="page-gutter py-8 pb-16">
        <div className="container-table">
          <DisplayNameReview rows={rows} />
        </div>
      </main>
    </div>
  );
}
