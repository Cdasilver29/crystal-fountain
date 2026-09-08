import type { Metadata } from "next";

import { AdminUnlock } from "@/components/admin/admin-unlock";
import { PledgeTable } from "@/components/admin/pledge-table";
import { CampaignProgress } from "@/components/campaign/campaign-progress";
import { db } from "@/db";
import { isAdmin } from "@/lib/admin-session";
import { CAMPAIGN_SLUG, getCampaignTotals } from "@/lib/campaign";
import * as pledges from "@/server/services/pledges";

export const metadata: Metadata = {
  title: "Pledges",
  robots: { index: false, follow: false },
};

// Reads a cookie, so it can never be prerendered.
export const dynamic = "force-dynamic";

export default async function AdminPledgesPage() {
  if (!(await isAdmin())) {
    return (
      <main className="flex flex-1 flex-col bg-neutral-50 px-4 pb-16">
        <AdminUnlock />
      </main>
    );
  }

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
            {rows.length.toLocaleString("en-KE")} pledges,{" "}
            {pendingCount.toLocaleString("en-KE")} awaiting approval. Only
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
