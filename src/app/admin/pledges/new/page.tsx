import type { Metadata } from "next";
import Link from "next/link";
import { forbidden, redirect } from "next/navigation";

import { AdminNav } from "@/components/admin/admin-nav";
import { PledgeRecordForm } from "@/components/admin/pledge-record-form";
import { getCurrentAdmin } from "@/lib/admin-context";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Record a pledge",
  robots: { index: false, follow: false },
};

/**
 * Recording a pledge somebody made on paper or over the phone.
 *
 * Treasurer and above, because this is the treasurer's daily work rather than
 * an administrative act. The route behind the form makes the same check and
 * writes an admin.forbidden row if anyone posts at it directly.
 */
export default async function AdminNewPledgePage() {
  const admin = await getCurrentAdmin();

  if (!admin) redirect("/admin/login?next=/admin/pledges/new");

  // A temporary password is still somebody else's. Nothing opens until it
  // has been changed.
  if (admin.mustChangePassword) redirect("/admin/change-password");

  if (!can(admin, "pledges.create")) forbidden();

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
          <Link
            href="/admin/pledges"
            className="rounded text-sm text-denim underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
          >
            Back to pledges
          </Link>

          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-navy">
            Record a pledge
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-600">
            For a pledge made on a card, at an event or over the phone. It is
            confirmed the moment you save it and counts toward the total
            straight away, because you are the check that approval exists to
            perform.
          </p>

          <div className="mt-6 rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
            <PledgeRecordForm />
          </div>
        </div>
      </main>
    </div>
  );
}
