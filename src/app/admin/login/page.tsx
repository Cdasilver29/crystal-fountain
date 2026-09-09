import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AdminLogin } from "@/components/admin/admin-login";
import { AdminUnlock } from "@/components/admin/admin-unlock";
import { db } from "@/db";
import { getCurrentAdmin } from "@/lib/admin-context";
import { isSetupAvailable } from "@/server/services/admin-setup";

export const metadata: Metadata = {
  title: "Admin sign in",
  robots: { index: false, follow: false },
};

// Reads cookies and counts users, so it can never be prerendered.
export const dynamic = "force-dynamic";

/**
 * The admin login screen.
 *
 * Navy ground, white card, campfire on the one button that matters, matching
 * the rest of the site. Anyone already signed in is sent on rather than shown
 * a form they do not need.
 */
export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const admin = await getCurrentAdmin();
  const { next } = await searchParams;

  // Only ever redirect to a path on this site. An absolute URL here would be
  // an open redirect handed to anyone who can write a link.
  const target =
    next && next.startsWith("/") && !next.startsWith("//")
      ? next
      : "/admin/pledges";

  if (admin) redirect(target);

  const setupOpen = await isSetupAvailable(db);

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-navy px-4 py-16 sm:px-6">
      <AdminLogin next={target} />

      {setupOpen && (
        <p className="mt-6 max-w-md text-center text-sm text-white/70">
          No administrator exists yet.{" "}
          <Link
            href="/admin/setup"
            className="rounded font-medium text-white underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
          >
            Create the first account
          </Link>
          .
        </p>
      )}

      {/*
        The old shared secret, still working. The middleware bounces an
        uncookied visitor off /admin/pledges, where this form used to live, so
        it has to be reachable here or the treasurer has no way in until the
        new accounts exist. Part B deletes this block along with the rest of
        the ADMIN_SECRET path.
      */}
      <details className="mt-8 w-full max-w-md">
        <summary className="cursor-pointer text-center text-sm text-white/60 hover:text-white/80">
          Use the old admin secret
        </summary>
        <AdminUnlock redirectTo={target} />
      </details>
    </main>
  );
}
