import type { Metadata } from "next";
import { forbidden, redirect } from "next/navigation";

import { AdminNav } from "@/components/admin/admin-nav";
import { PaymentChangeReview } from "@/components/admin/payment-change-review";
import { pendingChangeRequestCount } from "@/lib/admin-badges";
import { SettingsForm } from "@/components/admin/settings-form";
import { db } from "@/db";
import { getCurrentAdmin } from "@/lib/admin-context";
import { notifyPaymentChanges } from "@/lib/admin-notices";
import { CAMPAIGN_SLUG } from "@/lib/campaign";
import {
  builtInPaymentDetails,
  resolvePaymentDetails,
} from "@/lib/payment-details";
import { can } from "@/lib/permissions";
import * as campaign from "@/server/services/campaign";
import * as paymentChanges from "@/server/services/payment-changes";

/** The payment fields in the order the form shows them. */
const PAYMENT_ROWS = [
  ["mpesaPaybill", "M-Pesa business number"],
  ["mpesaAccountName", "M-Pesa account name"],
  ["bankAccountName", "Bank account name"],
  ["bankName", "Bank"],
  ["bankBranch", "Branch"],
  ["bankAccount", "Bank account number"],
  ["bankSwift", "Swift code"],
  ["bankBranchCode", "Branch code"],
] as const;

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Campaign settings",
  robots: { index: false, follow: false },
};

/**
 * The campaign settings.
 *
 * The super administrator's alone. Part 4's rights matrix put this with the
 * admin role and Part 7 put it with the super administrator; Part 7 wins,
 * because changing the target moves what the congregation is measured against
 * and changing the paybill moves where their money goes.
 *
 * An administrator who may give the second signature on a payment detail
 * change opens it too, and sees only the change waiting for them.
 */
export default async function AdminSettingsPage() {
  const admin = await getCurrentAdmin();

  if (!admin) redirect("/admin/login?next=/admin/settings");

  // A temporary password is still somebody else's. Nothing opens until it
  // has been changed.
  if (admin.mustChangePassword) redirect("/admin/change-password");

  const canEdit = can(admin, "settings.edit");
  const canApprove = can(admin, "settings.approvePaymentChange");

  if (!canEdit && !canApprove) forbidden();

  const settings = await campaign.getSettings(db, {
    campaignSlug: CAMPAIGN_SLUG,
  });

  // A change past its seven days is shown as gone, never as still waiting.
  notifyPaymentChanges(await paymentChanges.expireStale(db));
  const pending = await paymentChanges.getPending(db, { campaignId: settings.id });

  // What each payment field falls back to when its box is left empty, so the
  // placeholders show the value that is actually in use rather than nothing.
  const fallbacks = resolvePaymentDetails(null);
  const builtIn = builtInPaymentDetails();

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-50">
      <header className="bg-navy page-gutter py-5">
        <div className="container-table">
          <AdminNav
            name={admin.name}
            role={admin.role}
            isSuper={admin.isSuper}
            pendingChangeRequests={await pendingChangeRequestCount(admin)}
          />
        </div>
      </header>

      <main className="page-gutter py-8 pb-16">
        <div className="container-table">
          <h1 className="text-2xl font-semibold tracking-tight text-navy">
            Campaign settings
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-600">
            Every change here is written to the audit log with what it was and
            what it became, under your name, and every administrator is emailed
            about it at once. Changes to where money is sent wait for a second
            administrator to approve them.
          </p>

          {pending && (
            <div className="container-form mx-0 mt-6">
              <PaymentChangeReview
                change={{
                  id: pending.changeId,
                  requestedByName: pending.requestedByName,
                  requestedAt: pending.requestedAt.toISOString(),
                  expiresAt: pending.expiresAt.toISOString(),
                  rows: PAYMENT_ROWS.map(([field, label]) => {
                    const shown = (value: string | null | undefined) =>
                      value && value.trim() !== ""
                        ? value
                        : `${builtIn[field]} (built into the site)`;
                    return {
                      label,
                      current: shown(pending.current[field]),
                      proposed: shown(pending.proposed[field]),
                      moved:
                        (pending.current[field] ?? "") !==
                        (pending.proposed[field] ?? ""),
                    };
                  }),
                }}
                canApprove={canApprove}
                canReject={canApprove || pending.requestedBy === admin.id}
                isRequester={pending.requestedBy === admin.id}
              />
            </div>
          )}

          {!canEdit && !pending && (
            <p className="mt-6 max-w-2xl rounded-lg border border-black/5 bg-white px-4 py-3 text-sm text-neutral-700">
              No change to the payment details is waiting. Only the super
              administrator can change the settings themselves.
            </p>
          )}

          {canEdit && (
          <div className="container-form mx-0 mt-6">
            <SettingsForm
              paymentPending={pending !== null}
              settings={{
                targetMinor: settings.targetMinor.toString(),
                openingBalanceMinor: settings.openingBalanceMinor.toString(),
                autoApproveLimitMinor:
                  settings.autoApproveLimitMinor?.toString() ?? null,
                isPublic: settings.isPublic,
                mpesaPaybill: settings.mpesaPaybill,
                mpesaAccountName: settings.mpesaAccountName,
                bankName: settings.bankName,
                bankBranch: settings.bankBranch,
                bankAccountName: settings.bankAccountName,
                bankAccount: settings.bankAccount,
                bankSwift: settings.bankSwift,
                bankBranchCode: settings.bankBranchCode,
              }}
              fallbacks={{
                mpesaPaybill: fallbacks.paybill,
                mpesaAccountName: fallbacks.accountName,
                bankName: fallbacks.bankName,
                bankBranch: fallbacks.bankBranch,
                bankAccountName: fallbacks.bankAccountName,
                bankAccount: fallbacks.bankAccount,
                bankSwift: fallbacks.bankSwift,
                bankBranchCode: fallbacks.bankBranchCode,
              }}
            />
          </div>
          )}
        </div>
      </main>
    </div>
  );
}
