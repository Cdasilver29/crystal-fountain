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

          {/*
            The one screen in the portal that is about this account rather than
            the campaign, so it is where the second factor policy is stated.

            Only shown to a session that actually came in through Google. An
            administrator who has both methods and used their password this
            time was asked for a TOTP code as usual, and telling them otherwise
            would be wrong.
          */}
          {admin.signInMethod === "google" && (
            <div className="mt-4 rounded-xl bg-navy/5 p-4">
              <p className="text-sm leading-relaxed text-navy">
                You signed in with Google. Google&apos;s own two-factor
                protection applies to this session.
              </p>
              <p className="mt-2 text-sm leading-relaxed text-neutral-600">
                This portal did not ask you for an authenticator code, so the
                protection on your Google account is what stands in front of it.
                Your password and authenticator still work if you sign in that
                way instead.
              </p>
            </div>
          )}

          <div className="mt-6 rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
            <ChangePasswordForm forced={admin.mustChangePassword} />
          </div>
        </div>
      </main>
    </div>
  );
}
