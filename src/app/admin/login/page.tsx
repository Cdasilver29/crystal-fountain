import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AdminLogin } from "@/components/admin/admin-login";
import { db } from "@/db";
import { env } from "@/env";
import { getCurrentAdmin } from "@/lib/admin-context";
import { isSetupAvailable } from "@/server/services/admin-setup";
import {
  isGoogleConfigured,
  messageForRejection,
} from "@/server/services/admin-google";

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
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const admin = await getCurrentAdmin();
  const { next, error } = await searchParams;

  // Only ever redirect to a path on this site. An absolute URL here would be
  // an open redirect handed to anyone who can write a link.
  const target =
    next && next.startsWith("/") && !next.startsWith("//")
      ? next
      : "/admin/pledges";

  if (admin) redirect(target);

  const setupOpen = await isSetupAvailable(db);

  /*
   * Whether to offer the button at all, decided on the server. The keys never
   * reach the browser: the client id travels in the redirect Better Auth
   * builds server side, and the page is told only yes or no.
   */
  const googleEnabled = isGoogleConfigured({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  });

  /*
   * A refused Google sign in comes back here with ?error=<code>. The code is
   * mapped to one of our sentences and the query string's own
   * error_description is ignored, because that text is chosen by whoever wrote
   * the link and rendering it would put a stranger's words inside the portal's
   * error box.
   */
  const rejection = error ? messageForRejection(error) : null;

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-navy px-4 py-16 sm:px-6">
      <AdminLogin
        next={target}
        googleEnabled={googleEnabled}
        rejection={rejection}
      />

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
    </main>
  );
}
