import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AdminNav } from "@/components/admin/admin-nav";
import { ExportButton } from "@/components/admin/export-button";
import { PaymentTable } from "@/components/admin/payment-table";
import { db } from "@/db";
import { getCurrentAdmin } from "@/lib/admin-context";
import { can } from "@/lib/permissions";
import { CAMPAIGN_SLUG } from "@/lib/campaign";
import { formatKES, formatNumber } from "@/lib/format";
import * as payments from "@/server/services/payments";

export const metadata: Metadata = {
  title: "Payments",
  robots: { index: false, follow: false },
};

// Reads a cookie, so it can never be prerendered.
export const dynamic = "force-dynamic";

/**
 * The payment book.
 *
 * Every role may read this, including a viewer. Recording a payment is a
 * treasurer action and the button is hidden below that, but hiding it is
 * presentation: /api/admin/payments does its own check and writes an
 * admin.forbidden row if anyone posts at it directly.
 *
 * Paging is a link carrying the next cursor rather than a client side control,
 * so the screen works with scripting off and a page of the book can be sent to
 * someone as a URL. Going back is the browser back button, which is what people
 * reach for anyway.
 */
export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const admin = await getCurrentAdmin();

  if (!admin) redirect("/admin/login?next=/admin/payments");

  // A temporary password is still somebody else's. Nothing opens until it
  // has been changed.
  if (admin.mustChangePassword) redirect("/admin/change-password");

  const { cursor } = await searchParams;

  const page = await payments.listForAdmin(db, {
    campaignSlug: CAMPAIGN_SLUG,
    cursor,
  });

  const unallocatedCount = page.items.filter(
    (row) => row.allocationStatus !== "fully_allocated",
  ).length;

  const unallocatedMinor = page.items.reduce(
    (total, row) => total + row.unallocatedMinor,
    0n,
  );

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

          <div className="mt-1 flex flex-wrap items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              Payments
            </h1>

            {can(admin, "exports.download") && (
              <Link
                href="/admin/payments/new"
                className="inline-flex h-10 items-center justify-center rounded-lg bg-campfire px-5 text-sm font-semibold text-white transition-colors hover:bg-[#ef7433] focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-offset-2 focus-visible:ring-offset-navy focus-visible:outline-none"
              >
                Record a payment
              </Link>
            )}
          </div>

          <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/70">
            Money that has arrived. A payment counts toward the campaign total
            as soon as it is recorded, whether or not it has been matched to a
            pledge.
          </p>
        </div>
      </header>

      <main className="px-4 py-8 pb-16 sm:px-6">
        <div className="mx-auto w-full max-w-4xl">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-neutral-600">
              {formatNumber(page.items.length)} payments on this page,{" "}
              {formatNumber(unallocatedCount)} not yet fully matched to a
              pledge, {formatKES(unallocatedMinor)} still to allocate.
            </p>

            {/* The whole book, not this page of it. */}
            {can(admin, "payments.record") && (
              <ExportButton href="/api/admin/exports/payments.csv" />
            )}
          </div>

          <PaymentTable
            rows={page.items.map((row) => ({
              id: row.id,
              paidAt: row.paidAt.toISOString(),
              method: row.method,
              externalRef: row.externalRef,
              amountMinor: row.amountMinor.toString(),
              payerName: row.payerName,
              allocatedMinor: row.allocatedMinor.toString(),
              unallocatedMinor: row.unallocatedMinor.toString(),
              allocationStatus: row.allocationStatus,
            }))}
          />

          {(page.nextCursor || cursor) && (
            <nav
              aria-label="Payment book pages"
              className="mt-6 flex items-center justify-between gap-4"
            >
              {cursor ? (
                <Link
                  href="/admin/payments"
                  className="rounded text-sm font-medium text-denim underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
                >
                  Back to the newest
                </Link>
              ) : (
                <span />
              )}

              {page.nextCursor && (
                <Link
                  href={`/admin/payments?cursor=${encodeURIComponent(page.nextCursor)}`}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-neutral-300 bg-white px-5 text-sm font-medium text-navy transition-colors hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  Older payments
                </Link>
              )}
            </nav>
          )}
        </div>
      </main>
    </div>
  );
}
