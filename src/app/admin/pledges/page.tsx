import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PledgeTable } from "@/components/admin/pledge-table";
import { CampaignProgress } from "@/components/campaign/campaign-progress";
import { db } from "@/db";
import { getCurrentAdmin } from "@/lib/admin-context";
import { CAMPAIGN_SLUG, getCampaignTotals } from "@/lib/campaign";
import { formatNumber } from "@/lib/format";
import * as pledges from "@/server/services/pledges";

export const metadata: Metadata = {
  title: "Pledges",
  robots: { index: false, follow: false },
};

// Reads a cookie, so it can never be prerendered.
export const dynamic = "force-dynamic";

export default async function AdminPledgesPage() {
  /*
   * The middleware has already bounced anyone with no cookie at all, but it
   * only checks that a cookie is present: it runs on the edge, where there is
   * no node:crypto to verify the legacy HMAC and no database to look a session
   * up in. This is the check that actually decides.
   */
  const admin = await getCurrentAdmin();

  if (!admin) redirect("/admin/login?next=/admin/pledges");

  const [rows, totals] = await Promise.all([
    pledges.listForAdmin(db, { campaignSlug: CAMPAIGN_SLUG }),
    getCampaignTotals(),
  ]);

  const pendingCount = rows.filter((row) => row.status === "pending").length;

  return (
    <div className="flex flex-1 flex-col bg-neutral-50">
      <header className="bg-navy px-4 py-8 sm:px-6">
        <div className="mx-auto w-full max-w-4xl">
          <p className="text-sm text-white/70">
            Crystal Fountain Development Project
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">
            Pledges
          </h1>
          <div className="mt-6">
            <CampaignProgress totals={totals} compact />
          </div>
        </div>
      </header>

      <main className="px-4 py-8 pb-16 sm:px-6">
        <div className="mx-auto w-full max-w-4xl">
          <p className="mb-4 text-sm text-neutral-600">
            {formatNumber(rows.length)} pledges,{" "}
            {formatNumber(pendingCount)} awaiting approval. Only
            approved pledges count toward the public total.
          </p>

          <PledgeTable
            rows={rows.map((row) => ({
              id: row.id,
              reference: row.reference,
              fullName: row.fullName,
              amountMinor: row.amountMinor.toString(),
              status: row.status,
              createdAt: row.createdAt.toISOString(),
            }))}
          />
        </div>
      </main>
    </div>
  );
}
