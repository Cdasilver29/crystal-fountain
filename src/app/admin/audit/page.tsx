import type { Metadata } from "next";
import Link from "next/link";
import { forbidden, redirect } from "next/navigation";
import { headers } from "next/headers";

import { AdminNav } from "@/components/admin/admin-nav";
import { AuditFilters } from "@/components/admin/audit-filters";
import { AuditTable } from "@/components/admin/audit-table";
import { db } from "@/db";
import { getCurrentAdmin, hasAtLeast } from "@/lib/admin-context";
import { formatNumber } from "@/lib/format";
import { auditListFilters } from "@/server/contracts/admin";
import * as audit from "@/server/services/audit";
import * as adminAudit from "@/server/services/admin-audit";

export const metadata: Metadata = {
  title: "Audit log",
  robots: { index: false, follow: false },
};

// Reads a cookie, so it can never be prerendered.
export const dynamic = "force-dynamic";

/**
 * The audit journal.
 *
 * Administrator only. This is the one admin screen a treasurer cannot open,
 * and that is the point of it: the journal records what the treasurer did, and
 * a record its subjects can read and act on is a weaker one than a record they
 * cannot. A viewer is shut out for the same reason.
 *
 * A refused attempt writes an admin.forbidden row, exactly as the API routes
 * do. Somebody trying to open the log they are not cleared for is precisely
 * the sort of thing a log exists to notice.
 *
 * Read only from end to end, so there is no audit row for a successful visit.
 * CLAUDE.md requires one for every admin write, and reading writes nothing.
 *
 * Paging is a link carrying the next cursor rather than a client side control,
 * so a page of the journal can be sent to somebody as a URL and the screen
 * still works with scripting off. Going back is the browser back button.
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const admin = await getCurrentAdmin();

  if (!admin) redirect("/admin/login?next=/admin/audit");

  if (!hasAtLeast(admin, "admin")) {
    const heads = await headers();
    await adminAudit.recordForbidden(db, {
      adminUserId: admin.id,
      role: admin.role,
      attempted: "audit.read",
      entity: "audit_log",
      entityId: null,
      ip: heads.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: heads.get("user-agent"),
    });
    forbidden();
  }

  const raw = await searchParams;
  const filters = auditListFilters.parse({
    q: typeof raw.q === "string" ? raw.q : "",
    filter: typeof raw.filter === "string" ? raw.filter : "all",
    cursor: typeof raw.cursor === "string" ? raw.cursor : "",
  });

  const page = await audit.listForAdmin(db, {
    q: filters.q,
    filter: filters.filter,
    cursor: filters.cursor,
  });

  /** The current filters, minus the cursor, for the next page link. */
  const carried = new URLSearchParams();
  if (filters.q) carried.set("q", filters.q);
  if (filters.filter !== "all") carried.set("filter", filters.filter);

  const nextHref = page.nextCursor
    ? `/admin/audit?${new URLSearchParams({
        ...Object.fromEntries(carried),
        cursor: page.nextCursor,
      })}`
    : null;

  const firstHref = carried.toString()
    ? `/admin/audit?${carried}`
    : "/admin/audit";

  return (
    <div className="flex flex-1 flex-col bg-neutral-50">
      <header className="bg-navy px-4 py-8 sm:px-6">
        <div className="mx-auto w-full max-w-6xl">
          <AdminNav name={admin.name} role={admin.role} />

          <p className="mt-6 text-sm text-white/70">
            Crystal Fountain Development Project
          </p>

          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">
            Audit log
          </h1>

          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/70">
            Every recorded action, newest first. The journal is append only:
            nothing on this screen, and nothing anywhere else in the platform,
            can change or remove a row once it is written.
          </p>
        </div>
      </header>

      <main className="px-4 py-8 pb-16 sm:px-6">
        <div className="mx-auto w-full max-w-6xl">
          <div className="mb-4">
            <AuditFilters q={filters.q} filter={filters.filter} />
          </div>

          <p className="mb-4 text-sm text-neutral-600">
            {formatNumber(page.items.length)}{" "}
            {page.items.length === 1 ? "entry" : "entries"} on this page
            {page.hasMore ? ", more below" : ""}.
          </p>

          <AuditTable rows={page.items} />

          {(nextHref || filters.cursor) && (
            <nav
              aria-label="Audit log pages"
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
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-neutral-300 bg-white px-5 text-sm font-medium text-navy transition-colors hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  Older entries
                </Link>
              )}
            </nav>
          )}
        </div>
      </main>
    </div>
  );
}
