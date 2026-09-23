import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AdminNav } from "@/components/admin/admin-nav";
import { pendingChangeRequestCount } from "@/lib/admin-badges";
import { ExportButton } from "@/components/admin/export-button";
import { PledgeFilters } from "@/components/admin/pledge-filters";
import { PledgeTable } from "@/components/admin/pledge-table";
import { CampaignProgress } from "@/components/campaign/campaign-progress";
import { db } from "@/db";
import { getCurrentAdmin } from "@/lib/admin-context";
import { can } from "@/lib/permissions";
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
  searchParams: Promise<{
    q?: string;
    status?: string;
    name?: string;
    cursor?: string;
  }>;
}) {
  /*
   * The middleware has already bounced anyone with no cookie at all, but it
   * only checks that a cookie is present: it runs on the edge, where there is
   * no node:crypto to verify the legacy HMAC and no database to look a session
   * up in. This is the check that actually decides.
   */
  const admin = await getCurrentAdmin();

  if (!admin) redirect("/admin/login?next=/admin/pledges");

  // A temporary password is still somebody else's. Nothing opens until it
  // has been changed.
  if (admin.mustChangePassword) redirect("/admin/change-password");

  const params = await searchParams;

  // Every field tolerates rubbish and falls back, because these values come
  // from a URL somebody may have edited or bookmarked.
  const filters = pledgeListFilters.parse({
    q: params.q ?? "",
    status: params.status ?? "all",
    name: params.name ?? "all",
    cursor: params.cursor ?? "",
  });

  const listArgs = {
    campaignSlug: CAMPAIGN_SLUG,
    q: filters.q,
    status: filters.status === "all" ? null : filters.status,
    pledgerIds:
      filters.name === "review" ? await pledges.nameReviewPledgerIds(db) : null,
    cursor: filters.cursor,
  };

  /*
   * The figures come from their own count, never from the rows on screen. They
   * used to be counted off the loaded page, so page two of 97 pledges said "47
   * pledges, 0 awaiting approval" while a pledge sat unapproved on page one.
   */
  const canReviewNames = can(admin, "pledgers.setDisplayName");

  const [page, counts, totals, nameRows] = await Promise.all([
    pledges.listForAdmin(db, listArgs),
    pledges.countForAdmin(db, listArgs),
    getCampaignTotals(),
    canReviewNames
      ? pledges.listPublicNamesForReview(db, { campaignSlug: CAMPAIGN_SLUG })
      : [],
  ]);

  // The same rows the review screen lists, so the figure on the button is the
  // number of badges waiting there.
  const namesToCheck = nameRows.filter(
    (row) => row.publicDisplayName === null && row.automaticReview !== null,
  ).length;

  const filtering =
    filters.q !== null || filters.status !== "all" || filters.name !== "all";

  // Where this page sits in the whole list, for "Showing 51 to 97".
  const paged = counts.before > 0 || page.hasMore;
  const firstShown = counts.before + 1;
  const lastShown = counts.before + page.items.length;

  /** The same filters, pointed at the next page. */
  const nextHref = () => {
    const next = new URLSearchParams();
    if (filters.q) next.set("q", filters.q);
    if (filters.status !== "all") next.set("status", filters.status);
    if (filters.name !== "all") next.set("name", filters.name);
    if (page.nextCursor) next.set("cursor", page.nextCursor);
    return `/admin/pledges?${next.toString()}`;
  };

  /** The first page of the same filters, for stepping back out of paging. */
  const firstHref = () => {
    const first = new URLSearchParams();
    if (filters.q) first.set("q", filters.q);
    if (filters.status !== "all") first.set("status", filters.status);
    if (filters.name !== "all") first.set("name", filters.name);
    const query = first.toString();
    return query ? `/admin/pledges?${query}` : "/admin/pledges";
  };

  return (
    <div className="flex flex-1 flex-col bg-neutral-50">
      <header className="bg-navy px-4 py-8 sm:px-6">
        <div className="mx-auto w-full max-w-4xl">
          <AdminNav
            name={admin.name}
            role={admin.role}
            isSuper={admin.isSuper}
            pendingChangeRequests={await pendingChangeRequestCount(admin)}
          />

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
              <PledgeFilters
                q={filters.q}
                status={filters.status}
                name={filters.name}
              />
            </div>

            {can(admin, "pledges.create") && (
              <Link
                href="/admin/pledges/new"
                className="btn-primary inline-flex h-9 items-center justify-center bg-campfire px-4 text-sm font-medium text-white focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
              >
                Record a pledge
              </Link>
            )}

            {can(admin, "exports.download") && (
              <ExportButton href="/api/admin/exports/pledges.csv" />
            )}

            {canReviewNames && (
              <Link
                href="/admin/pledges/display-names"
                className="btn-secondary inline-flex h-11 shrink-0 items-center justify-center gap-2 border border-neutral-300 bg-white px-4 text-sm font-medium text-navy focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                Review public names
                {namesToCheck > 0 && (
                  <span className="tabular rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                    {namesToCheck}
                    <span className="sr-only"> to check</span>
                  </span>
                )}
              </Link>
            )}
          </div>

          <p className="mb-4 text-sm text-neutral-600">
            {formatNumber(counts.total)}
            {filtering ? " matching" : ""}{" "}
            {counts.total === 1 ? "pledge" : "pledges"},{" "}
            {formatNumber(counts.pending)} awaiting approval.
            {paged && page.items.length > 0 && (
              <>
                {" "}
                Showing {formatNumber(firstShown)} to {formatNumber(lastShown)}.
              </>
            )}
            {!filtering && (
              <> Only approved pledges count toward the public total.</>
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
              nameReview: row.nameReview?.reason ?? null,
              publicNameEdited: row.publicNameEdited,
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
                  className="btn-secondary inline-flex h-10 items-center justify-center border border-neutral-300 bg-white px-5 text-sm font-medium text-navy focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-offset-2 focus-visible:outline-none"
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
