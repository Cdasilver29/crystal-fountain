import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AdminNav } from "@/components/admin/admin-nav";
import {
  AllocationsTable,
  Field,
  OrNone,
  SuggestionList,
  UnallocatedSummary,
} from "@/components/admin/payment-detail";
import { db } from "@/db";
import { getCurrentAdmin } from "@/lib/admin-context";
import { formatDate, formatKES, formatPhoneForDisplay } from "@/lib/format";
import { paymentPathParams } from "@/server/contracts/payments";
import { percentOf } from "@/server/money";
import * as payments from "@/server/services/payments";

export const metadata: Metadata = {
  title: "Payment",
  robots: { index: false, follow: false },
};

// Reads a cookie, so it can never be prerendered.
export const dynamic = "force-dynamic";

/**
 * One payment, and what it has been matched to.
 *
 * Every role may read this. The allocate and remove controls are a separate
 * client component and are not on this page yet; when they arrive, a viewer
 * will not see them, and the endpoints behind them enforce that independently.
 *
 * The suggestions are computed on the server for the first render rather than
 * fetched from /api/admin/payments/:id/suggestions. The endpoint exists for the
 * client component that will re-read them after an allocation, but a screen
 * that renders its own first paint has one fewer round trip and no loading
 * state to design.
 */
export default async function PaymentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await getCurrentAdmin();
  const { id } = await params;

  if (!admin) redirect(`/admin/login?next=/admin/payments/${id}`);

  // A malformed id is a 404, not a 500 from the uuid cast in the query.
  const target = paymentPathParams.safeParse({ paymentId: id });
  if (!target.success) notFound();

  const payment = await payments.getForAdmin(db, {
    paymentId: target.data.paymentId,
  });

  if (!payment) notFound();

  const suggestions = await payments.suggestMatches(db, {
    paymentId: payment.id,
  });

  const percentAllocated = percentOf(payment.allocatedMinor, payment.amountMinor);

  return (
    <div className="flex flex-1 flex-col bg-neutral-50">
      <header className="bg-navy px-4 py-8 sm:px-6">
        <div className="mx-auto w-full max-w-4xl">
          <AdminNav name={admin.name} role={admin.role} />

          <Link
            href="/admin/payments"
            className="mt-6 inline-block rounded text-sm text-white/70 underline-offset-4 hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
          >
            Back to payments
          </Link>

          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">
            {formatKES(payment.amountMinor.toString())}{" "}
            <span className="font-normal text-white/70 capitalize">
              by {payment.method}
            </span>
          </h1>

          <p className="mt-2 text-sm text-white/70">
            Recorded by {payment.recordedByName ?? "an unknown admin"} on{" "}
            {formatDate(payment.createdAt)}
          </p>
        </div>
      </header>

      <main className="px-4 py-8 pb-16 sm:px-6">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
          <section aria-labelledby="details-heading">
            <h2
              id="details-heading"
              className="mb-3 text-lg font-semibold text-navy"
            >
              Payment details
            </h2>

            <dl className="grid grid-cols-1 gap-5 rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:grid-cols-3">
              <Field label="Method">
                <span className="capitalize">{payment.method}</span>
              </Field>
              <Field label="Reference">
                <span className="tabular">
                  <OrNone value={payment.externalRef} />
                </span>
              </Field>
              <Field label="Amount">
                <span className="tabular font-medium">
                  {formatKES(payment.amountMinor.toString())}
                </span>
              </Field>
              <Field label="Payer">
                <OrNone value={payment.payerName} />
              </Field>
              <Field label="Payer phone">
                <span className="tabular">
                  {payment.payerMsisdn ? (
                    formatPhoneForDisplay(payment.payerMsisdn)
                  ) : (
                    <OrNone value={null} />
                  )}
                </span>
              </Field>
              <Field label="Account reference">
                <span className="tabular">
                  <OrNone value={payment.accountRef} />
                </span>
              </Field>
              <Field label="Date paid">{formatDate(payment.paidAt)}</Field>
              <Field label="Status">
                <span className="capitalize">{payment.status}</span>
              </Field>
            </dl>
          </section>

          <section aria-labelledby="remainder-heading">
            <h2 id="remainder-heading" className="sr-only">
              How much of this payment is allocated
            </h2>
            <UnallocatedSummary
              amountMinor={payment.amountMinor.toString()}
              allocatedMinor={payment.allocatedMinor.toString()}
              unallocatedMinor={payment.unallocatedMinor.toString()}
              percentAllocated={percentAllocated}
            />
          </section>

          <section aria-labelledby="allocations-heading">
            <h2
              id="allocations-heading"
              className="mb-3 text-lg font-semibold text-navy"
            >
              Allocations
            </h2>
            <AllocationsTable
              rows={payment.allocations.map((row) => ({
                id: row.id,
                pledgeId: row.pledgeId,
                pledgeReference: row.pledgeReference,
                pledgerName: row.pledgerName,
                amountMinor: row.amountMinor.toString(),
                allocatedAt: row.allocatedAt.toISOString(),
                allocatedByName: row.allocatedByName,
                reversedAt: row.reversedAt?.toISOString() ?? null,
                reversedByName: row.reversedByName,
              }))}
            />
          </section>

          {payment.unallocatedMinor > 0n && (
            <section aria-labelledby="suggestions-heading">
              <h2
                id="suggestions-heading"
                className="mb-1 text-lg font-semibold text-navy"
              >
                Suggested matches
              </h2>
              <p className="mb-3 text-sm text-neutral-600">
                Pledges this payment may belong to, best guess first. A
                reference match is what the payer typed as the account number,
                so it is the strongest signal. A name match is only a guess.
              </p>
              <SuggestionList
                rows={suggestions.map((row) => ({
                  pledgeId: row.pledgeId,
                  reference: row.reference,
                  fullName: row.fullName,
                  outstandingMinor: row.outstandingMinor.toString(),
                  matchReason: row.matchReason,
                  confidence: row.confidence,
                }))}
              />
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
