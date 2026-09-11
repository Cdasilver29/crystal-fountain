import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ChangePasswordForm } from "@/components/admin/change-password-form";
import { getCurrentAdmin } from "@/lib/admin-context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Set your password",
  robots: { index: false, follow: false },
};

/**
 * Where somebody carrying a temporary password is sent, and the one admin
 * screen that opens while the forced change flag is set.
 *
 * Deliberately carries no navigation. Every other screen bounces back here
 * until the password has been changed, so links to them would be links to a
 * redirect, and the point of the flag is that this account can do exactly one
 * thing until it is cleared.
 */
export default async function AdminChangePasswordPage() {
  const admin = await getCurrentAdmin();

  if (!admin) redirect("/admin/login?next=/admin/change-password");

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-50">
      <header className="bg-navy px-4 py-5 sm:px-6">
        <div className="mx-auto w-full max-w-md">
          <p className="text-sm text-white/70">
            Crystal Fountain, administration
          </p>
        </div>
      </header>

      <main className="flex flex-1 items-start px-4 py-10 sm:px-6">
        <div className="mx-auto w-full max-w-md">
          <h1 className="text-2xl font-semibold tracking-tight text-navy">
            Set your password
          </h1>
          <p className="mt-2 text-sm text-neutral-600">
            Signed in as {admin.email}.
          </p>

          <div className="mt-6 rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
            <ChangePasswordForm forced={admin.mustChangePassword} />
          </div>
        </div>
      </main>
    </div>
  );
}
