import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AdminNav } from "@/components/admin/admin-nav";
import { PaymentForm } from "@/components/admin/payment-form";
import { getCurrentAdmin, hasAtLeast } from "@/lib/admin-context";

export const metadata: Metadata = {
  title: "Record a payment",
  robots: { index: false, follow: false },
};

// Reads a cookie, so it can never be prerendered.
export const dynamic = "force-dynamic";

/**
 * Recording a payment the treasurer has seen arrive.
 *
 * Treasurer and admin only. A viewer who reaches this by typing the URL is
 * sent back to the pledge list rather than shown a form that would refuse
 * them: the endpoint behind it enforces the same rule and writes an
 * admin.forbidden row if anyone posts at it directly.
 */
export default async function NewPaymentPage() {
  const admin = await getCurrentAdmin();

  if (!admin) redirect("/admin/login?next=/admin/payments/new");
  if (!hasAtLeast(admin, "treasurer")) redirect("/admin/pledges");

  return (
    <div className="flex flex-1 flex-col bg-neutral-50">
      <header className="bg-navy px-4 py-8 sm:px-6">
        <div className="mx-auto w-full max-w-2xl">
          <AdminNav name={admin.name} role={admin.role} />

          <h1 className="mt-6 text-2xl font-semibold tracking-tight text-white">
            Record a payment
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/70">
            This records money that has arrived. It does not match it to a
            pledge yet, and it counts toward the campaign total straight away.
          </p>
        </div>
      </header>

      <main className="px-4 py-8 pb-16 sm:px-6">
        <div className="mx-auto w-full max-w-2xl">
          <PaymentForm />
        </div>
      </main>
    </div>
  );
}
