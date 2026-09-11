import type { Metadata } from "next";
import { forbidden, redirect } from "next/navigation";

import { AdminNav } from "@/components/admin/admin-nav";
import { UserTable } from "@/components/admin/user-table";
import { db } from "@/db";
import { getCurrentAdmin } from "@/lib/admin-context";
import { can } from "@/lib/permissions";
import * as adminUsers from "@/server/services/admin-users";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Administrators",
  robots: { index: false, follow: false },
};

/**
 * Who can sign in to the portal.
 *
 * Admin role and above. Creating another administrator is narrower still and
 * belongs to the super administrator alone, which the form respects by leaving
 * the role off its list and the route enforces regardless.
 *
 * No permission is checked twice for show: hiding a control is presentation,
 * and every route behind these buttons makes the same call and writes an
 * admin.forbidden row when it refuses.
 */
export default async function AdminUsersPage() {
  const admin = await getCurrentAdmin();

  if (!admin) redirect("/admin/login?next=/admin/users");

  // A temporary password is still somebody else's. Nothing else opens until it
  // has been changed.
  if (admin.mustChangePassword) redirect("/admin/change-password");

  if (!can(admin, "users.manage")) forbidden();

  const [users, capacity] = await Promise.all([
    adminUsers.list(db),
    adminUsers.capacity(db),
  ]);

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-50">
      <header className="bg-navy px-4 py-5 sm:px-6">
        <div className="mx-auto w-full max-w-5xl">
          <AdminNav
            name={admin.name}
            role={admin.role}
            isSuper={admin.isSuper}
          />
        </div>
      </header>

      <main className="px-4 py-8 pb-16 sm:px-6">
        <div className="mx-auto w-full max-w-5xl">
          <h1 className="text-2xl font-semibold tracking-tight text-navy">
            Administrators
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-600">
            Accounts are retired rather than deleted, because every audit entry
            and every payment recorded by a person points at their row. A
            retired account cannot sign in and frees its place under the limit.
          </p>

          <div className="mt-6">
            <UserTable
              initial={users.map((row) => ({
                ...row,
                lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
                createdAt: row.createdAt.toISOString(),
              }))}
              capacity={capacity}
              me={{ id: admin.id, isSuper: admin.isSuper }}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
