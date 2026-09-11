import type { Metadata } from "next";
import { forbidden, redirect } from "next/navigation";

import { AdminNav } from "@/components/admin/admin-nav";
import { SettingsForm } from "@/components/admin/settings-form";
import { db } from "@/db";
import { getCurrentAdmin } from "@/lib/admin-context";
import { CAMPAIGN_SLUG } from "@/lib/campaign";
import { resolvePaymentDetails } from "@/lib/payment-details";
import { can } from "@/lib/permissions";
import * as campaign from "@/server/services/campaign";

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
 */
export default async function AdminSettingsPage() {
  const admin = await getCurrentAdmin();

  if (!admin) redirect("/admin/login?next=/admin/settings");

  // A temporary password is still somebody else's. Nothing opens until it
  // has been changed.
  if (admin.mustChangePassword) redirect("/admin/change-password");

  if (!can(admin, "settings.edit")) forbidden();

  const settings = await campaign.getSettings(db, {
    campaignSlug: CAMPAIGN_SLUG,
  });

  // What each payment field falls back to when its box is left empty, so the
  // placeholders show the value that is actually in use rather than nothing.
  const fallbacks = resolvePaymentDetails(null);

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-50">
      <header className="bg-navy px-4 py-5 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <AdminNav
            name={admin.name}
            role={admin.role}
            isSuper={admin.isSuper}
          />
        </div>
      </header>

      <main className="px-4 py-8 pb-16 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <h1 className="text-2xl font-semibold tracking-tight text-navy">
            Campaign settings
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-600">
            Every change here is written to the audit log with what it was and
            what it became, under your name. These are the figures the public
            site is measured against and the accounts the congregation&rsquo;s
            money is sent to.
          </p>

          <div className="mt-6">
            <SettingsForm
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
        </div>
      </main>
    </div>
  );
}
