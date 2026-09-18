import type { Metadata } from "next";
import Link from "next/link";
import { forbidden, redirect } from "next/navigation";

import { AdminNav } from "@/components/admin/admin-nav";
import { ChangeRequestFilters } from "@/components/admin/change-request-filters";
import { ChangeRequestQueue } from "@/components/admin/change-request-queue";
import { db } from "@/db";
import { getCurrentAdmin } from "@/lib/admin-context";
import { CAMPAIGN_SLUG } from "@/lib/campaign";
import { formatNumber } from "@/lib/format";
import { can } from "@/lib/permissions";
import { changeRequestListFilters } from "@/server/contracts/change-requests";
import * as changeRequests from "@/server/services/change-requests";

export const metadata: Metadata = {
  title: "Change requests",
  robots: { index: false, follow: false },
};

// Reads a cookie, so it can never be prerendered.
export const dynamic = "force-dynamic";

/**
 * What pledgers have asked to have changed.
 *
 * Everything the pledge form cannot do on its own: reducing an amount,
 * changing a plan, correcting a name, reporting a payment that never showed
 * up, and cancelling. Increasing a pledge is not here and never will be, since
 * the form adds to an existing pledge without anybody's approval.
 *
 * Every signed in role can read this, so a refusal here is close to
 * impossible, and no admin.forbidden row is written for a page render: opening
 * a screen is a read, and the route behind the buttons is what records an
 * actual attempt. The audit log screen writes one because it is the screen a
 * treasurer is deliberately shut out of, and this is not.
 *
 * Paging is a link carrying the next cursor rather than a client side control,
 * so a filtered page of the queue can be sent to somebody as a URL and the
 * screen still works with scripting off. Going back is the browser back
 * button.
 */
export default async function AdminChangeRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const admin = await getCurrentAdmin();

  if (!admin) redirect("/admin/login?next=/admin/change-requests");

  // A temporary password is still somebody else's. Nothing opens until it has
  // been changed.
  if (admin.mustChangePassword) redirect("/admin/change-password");

  if (!can(admin, "changeRequests.view")) forbidden();

  const raw = await searchParams;
  const filters = changeRequestListFilters.parse({
    status: typeof raw.status === "string" ? raw.status : "pending",
    kind: typeof raw.kind === "string" ? raw.kind : "all",
    cursor: typeof raw.cursor === "string" ? raw.cursor : "",
  });

  const page = await changeRequests.listForAdmin(db, {
    campaignSlug: CAMPAIGN_SLUG,
    status: filters.status === "all" ? null : filters.status,
    kind: filters.kind === "all" ? null : filters.kind,
    cursor: filters.cursor,
    /*
     * A treasurer reconciling a reported M-Pesa payment against a pledge needs
     * the whole number. A viewer has no task that does, so they keep seeing
     * the last three digits. The service masks it rather than trusting this
     * page to.
     */
    revealPhone: can(admin, "pledges.viewPhone"),
  });

  /** The current filters, minus the cursor, for the next page link. */
  const carried = new URLSearchParams();
  if (filters.status !== "pending") carried.set("status", filters.status);
  if (filters.kind !== "all") carried.set("kind", filters.kind);

  const nextHref = page.nextCursor
    ? `/admin/change-requests?${new URLSearchParams({
        ...Object.fromEntries(carried),
        cursor: page.nextCursor,
      })}`
    : null;

  const firstHref = carried.toString()
    ? `/admin/change-requests?${carried}`
    : "/admin/change-requests";

  const rows = page.items.map((row) => ({
    id: row.id,
    pledgeId: row.pledgeId,
    kind: row.kind,
    status: row.status,
    reference: row.reference,
    pledgerName: row.pledgerName,
    contactPhone: row.contactPhone,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    // Minor units cross to the client as strings. They are still exact.
    currentAmountMinor: row.currentAmountMinor.toString(),
    currentFrequency: row.currentFrequency,
    requestedAmountMinor: row.requestedAmountMinor?.toString() ?? null,
    requestedFrequency: row.requestedFrequency,
    requestedName: row.requestedName,
    paymentReference: row.paymentReference,
    paymentAmountMinor: row.paymentAmountMinor?.toString() ?? null,
    paymentPaidOn: row.paymentPaidOn,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decidedByName: row.decidedByName,
    decisionNote: row.decisionNote,
  }));

  return (
    <div className="flex flex-1 flex-col bg-neutral-50">
      <header className="bg-navy px-4 py-8 sm:px-6">
        <div className="mx-auto w-full max-w-4xl">
          <AdminNav
            name={admin.name}
            role={admin.role}
            isSuper={admin.isSuper}
          />

          <p className="mt-6 text-sm text-white/70">
            Crystal Fountain Development Project
          </p>

          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">
            Change requests
          </h1>

          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/70">
            What pledgers have asked to have changed, newest first. Nothing here
            has touched a pledge: a request is a question, and the pledge moves
            only when somebody answers it on this screen.
          </p>
        </div>
      </header>

      <main className="px-4 py-8 pb-16 sm:px-6">
        <div className="mx-auto w-full max-w-4xl">
          <div className="mb-4">
            <ChangeRequestFilters
              status={filters.status}
              kind={filters.kind}
            />
          </div>

          <p className="mb-4 text-sm text-neutral-600">
            {formatNumber(rows.length)}{" "}
            {rows.length === 1 ? "request" : "requests"} on this page
            {page.hasMore ? ", more below" : ""}.
          </p>

          <ChangeRequestQueue
            rows={rows}
            canDecide={can(admin, "changeRequests.decide")}
            canDecideCancellation={can(
              admin,
              "changeRequests.decideCancellation",
            )}
          />

          {(nextHref || filters.cursor) && (
            <nav
              aria-label="Change request pages"
              className="mt-6 flex items-center justify-between gap-4"
            >
              {filters.cursor ? (
                <Link
                  href={firstHref}
                  className="rounded text-sm font-medium text-denim underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
                >
                  Back to the newest
                </Link>
              ) : (
                <span />
              )}

              {nextHref && (
                <Link
                  href={nextHref}
                  className="btn-secondary inline-flex h-10 items-center justify-center border border-neutral-300 bg-white px-5 text-sm font-medium text-navy focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  Older requests
                </Link>
              )}
            </nav>
          )}
        </div>
      </main>
    </div>
  );
}
