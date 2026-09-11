"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import type { AdminRole } from "@/lib/admin-context";
import { can, type AdminAction } from "@/lib/permissions";

/**
 * The admin nav.
 *
 * One component across every admin screen, carrying the links, who is signed
 * in and the way out. The role sits next to the name because it is what
 * decides whether the screen will let this person act, and a viewer wondering
 * why a button refuses should not have to guess.
 *
 * Links are filtered by role here, but that is presentation and nothing more.
 * Every route behind these does its own check server side; hiding a link is
 * not what stops anyone.
 */

type NavLink = {
  href: string;
  label: string;
  /** The permission that opens this screen, from the one rights table. */
  needs: AdminAction;
};

const LINKS: readonly NavLink[] = [
  { href: "/admin/pledges", label: "Pledges", needs: "pledges.view" },
  // The book itself, not the form. Every role may read it, and the button to
  // record one lives on the page, where only a treasurer sees it.
  { href: "/admin/payments", label: "Payments", needs: "payments.view" },
  // Counts and totals only, nothing to act on and nobody named, so a viewer
  // sees the same page a treasurer does.
  { href: "/admin/analytics", label: "Analytics", needs: "analytics.view" },
  // The one screen a treasurer cannot open. The journal records what the
  // treasurer did, and a record its subjects can read is a weaker one.
  { href: "/admin/audit", label: "Audit log", needs: "audit.view" },
  { href: "/admin/users", label: "Users", needs: "users.manage" },
];

export function AdminNav({
  name,
  role,
  isSuper = false,
}: {
  name: string;
  role: AdminRole;
  /** Shown beside the role, because it changes what the portal will allow. */
  isSuper?: boolean;
}) {
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);

  const visible = LINKS.filter((link) => can({ role, isSuper }, link.needs));

  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } catch {
      // Going to the login screen anyway. The cookie is httpOnly and only the
      // server can clear it, so if the request did not land the login screen
      // will simply not treat them as signed out.
    }
    // A full navigation, so the server reads the cleared cookie rather than a
    // cached RSC payload.
    window.location.assign("/admin/login");
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <nav aria-label="Admin" className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {visible.map((link) => {
          const current =
            pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={current ? "page" : undefined}
              className="rounded text-sm text-white/70 underline-offset-4 hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none aria-[current=page]:font-medium aria-[current=page]:text-campfire"
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-white/70">
          <span className="font-medium text-white">{name}</span>
          {/*
            The super administrator is told so. It is the difference between a
            button being missing because of a bug and being missing because
            this account is not the one that holds that power.
          */}
          <span className="text-white/50">
            {" "}
            ({isSuper ? "super admin" : role})
          </span>
        </p>

        <button
          type="button"
          onClick={signOut}
          disabled={busy}
          className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg border border-white/20 px-4 text-sm font-medium text-white transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-offset-2 focus-visible:ring-offset-navy focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Signing out" : "Sign out"}
        </button>
      </div>
    </div>
  );
}
