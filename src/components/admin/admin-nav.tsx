"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import type { AdminRole } from "@/lib/admin-context";

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
  /** The least role that may see this link. */
  minRole: AdminRole;
};

const RANK: Record<AdminRole, number> = { viewer: 1, treasurer: 2, admin: 3 };

const LINKS: readonly NavLink[] = [
  { href: "/admin/pledges", label: "Pledges", minRole: "viewer" },
  // Points at the form until the payments list lands, which is the next
  // session. Moving it is a one line change here.
  { href: "/admin/payments/new", label: "Record a payment", minRole: "treasurer" },
];

export function AdminNav({
  name,
  role,
}: {
  name: string;
  role: AdminRole;
}) {
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);

  const visible = LINKS.filter((link) => RANK[role] >= RANK[link.minRole]);

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
          <span className="text-white/50"> ({role})</span>
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
