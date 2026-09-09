import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminSetup } from "@/components/admin/admin-setup";
import { db } from "@/db";
import { isSetupAvailable } from "@/server/services/admin-setup";

export const metadata: Metadata = {
  title: "First run setup",
  robots: { index: false, follow: false },
};

// Counts rows on every request, so it can never be prerendered.
export const dynamic = "force-dynamic";

/**
 * First run setup.
 *
 * Open only while there is no administrator at all, in either table. The
 * moment one exists this is a 404 and stays one, which is the same answer an
 * unknown path gives, so its existence is not something to probe for. The POST
 * endpoint behind it gates itself the same way rather than trusting this.
 */
export default async function AdminSetupPage() {
  if (!(await isSetupAvailable(db))) notFound();

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-navy px-4 py-16 sm:px-6">
      <AdminSetup />
    </main>
  );
}
