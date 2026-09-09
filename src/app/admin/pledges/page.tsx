import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AdminNav } from "@/components/admin/admin-nav";
import { ExportButton } from "@/components/admin/export-button";
import { PledgeFilters } from "@/components/admin/pledge-filters";
import { PledgeTable } from "@/components/admin/pledge-table";
import { CampaignProgress } from "@/components/campaign/campaign-progress";
import { db } from "@/db";
import { getCurrentAdmin, hasAtLeast } from "@/lib/admin-context";
import { CAMPAIGN_SLUG, getCampaignTotals } from "@/lib/campaign";
import { formatNumber } from "@/lib/format";
import { pledgeListFilters } from "@/server/contracts/admin";
import * as pledges from "@/server/services/pledges";

export const metadata: Metadata = {
  title: "Pledges",
  robots: { index: false, follow: false },
};

// Reads a cookie, so it can never be prerendered.
export const dynamic = "force-dynamic";

export default async function AdminPledgesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; cursor?: string }>;
}) {
  /*
   * The middleware has already bounced anyone with no cookie at all, but it
   * only checks that a cookie is present: it runs on the edge, where there is
   * no node:crypto to verify the legacy HMAC and no database to look a session
   * up in. This is the check that actually decides.
   */
  const admin = await getCurrentAdmin();

  if (!admin) redirect("/admin/login?next=/admin/pledges");

  const params = await searchParams;

  // Every field tolerates rubbish and falls back, because these values come
  // from a URL somebody may have edited or bookmarked.
  const filters = pledgeListFilters.parse({
    q: params.q ?? "",
    status: params.status ?? "all",
    cursor: params.cursor ?? "",
  });

  const [page, totals] = await Promise.all([
    pledges.listForAdmin(db, {
      campaignSlug: CAMPAIGN_SLUG,
      q: filters.q,
      status: filters.status === "all" ? null : filters.status,
      cursor: filters.cursor,
    }),
    getCampaignTotals(),
  ]);

  const pendingCount = page.items.filter(
    (row) => row.status === "pending",
  ).length;

  const filtering = filters.q !== null || filters.status !== "all";

  /** The same filters, pointed at the next page. */
  const nextHref = () => {
    const next = new URLSearchParams();
    if (filters.q) next.set("q", filters.q);
    if (filters.status !== "all") next.set("status", filters.status);
    if (page.nextCursor) next.set("cursor", page.nextCursor);
    return `/admin/pledges?${next.toString()}`;
  };

  /** The first page of the same filters, for stepping back out of paging. */
  const firstHref = () => {
    const first = new URLSearchParams();
    if (filters.q) first.set("q", filters.q);
    if (filters.status !== "all") first.set("status", filters.status);
    const query = first.toString();
    return query ? `/admin/pledges?${query}` : "/admin/pledges";
  };

  return (
    <div className="flex flex-1 flex-col bg-neutral-50">
      <header className="bg-navy px-4 py-8 sm:px-6">
        <div className="mx-auto w-full max-w-4xl">
          <AdminNav name={admin.name} role={admin.role} />

          <p className="mt-6 text-sm text-white/70">
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
          {/*
            The export sits beside the filters but is not one of them: it hands
            out the whole book, not the filtered page, so it does not move when
            a filter changes.
          */}
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="flex-1">
              <PledgeFilters q={filters.q} status={filters.status} />
            </div>

            {hasAtLeast(admin, "treasurer") && (
              <ExportButton href="/api/admin/exports/pledges.csv" />
            )}
          </div>

          <p className="mb-4 text-sm text-neutral-600">
            {filtering ? (
              <>
                {formatNumber(page.items.length)} matching{" "}
                {page.items.length === 1 ? "pledge" : "pledges"} on this page.
              </>
            ) : (
              <>
                {formatNumber(page.items.length)} pledges,{" "}
                {formatNumber(pendingCount)} awaiting approval. Only approved
                pledges count toward the public total.
              </>
            )}
          </p>

          <PledgeTable
            rows={page.items.map((row) => ({
              id: row.id,
              reference: row.reference,
              fullName: row.fullName,
              amountMinor: row.amountMinor.toString(),
              status: row.status,
              createdAt: row.createdAt.toISOString(),
            }))}
          />

          {(page.nextCursor || filters.cursor) && (
            <nav
              aria-label="Pledge list pages"
              className="mt-6 flex items-center justify-between gap-4"
            >
              {filters.cursor ? (
                <Link
                  href={firstHref()}
                  className="rounded text-sm font-medium text-denim underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
                >
                  Back to the newest
                </Link>
              ) : (
                <span />
              )}

              {page.nextCursor && (
                <Link
                  href={nextHref()}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-neutral-300 bg-white px-5 text-sm font-medium text-navy transition-colors hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  Older pledges
                </Link>
              )}
            </nav>
          )}
        </div>
      </main>
    </div>
  );
}
