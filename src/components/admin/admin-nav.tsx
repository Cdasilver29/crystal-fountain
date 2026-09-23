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
  /*
   * What pledgers have asked to have changed. Every role may read the queue;
   * the buttons on it are what a viewer will not be given. The pending count
   * that belongs on this item is the next session's, because no admin layout
   * exists and every page renders this nav itself.
   */
  {
    href: "/admin/change-requests",
    label: "Change requests",
    needs: "changeRequests.view",
  },
  // Counts and totals only, nothing to act on and nobody named, so a viewer
  // sees the same page a treasurer does.
  { href: "/admin/analytics", label: "Analytics", needs: "analytics.view" },
  // The one screen a treasurer cannot open. The journal records what the
  // treasurer did, and a record its subjects can read is a weaker one.
  { href: "/admin/audit", label: "Audit log", needs: "audit.view" },
  { href: "/admin/users", label: "Users", needs: "users.manage" },
  // The super administrator only. Changing the target moves what the
  // congregation is measured against, and changing the paybill moves where
  // their money goes.
  { href: "/admin/settings", label: "Settings", needs: "settings.edit" },
];

export function AdminNav({
  name,
  role,
  isSuper = false,
  pendingChangeRequests = 0,
}: {
  name: string;
  role: AdminRole;
  /** Shown beside the role, because it changes what the portal will allow. */
  isSuper?: boolean;
  /**
   * How many change requests are waiting, for the badge.
   *
   * Passed in by every page rather than fetched here, because this is a client
   * component and the count is a database read. Defaulting to zero means a
   * page that forgets it shows no badge rather than a wrong one, which is the
   * safe direction: a treasurer who sees nothing goes and looks, and one who
   * sees a stale number believes it.
   */
  pendingChangeRequests?: number;
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
          const waiting =
            link.href === "/admin/change-requests" ? pendingChangeRequests : 0;

          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={current ? "page" : undefined}
              className="inline-flex items-center gap-1.5 rounded text-sm text-white/70 underline-offset-4 hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none aria-[current=page]:font-medium aria-[current=page]:text-campfire"
            >
              {link.label}

              {/*
                The count is in the link's accessible name rather than only in
                the badge, because "Change requests 3" read aloud is the whole
                point of the badge and a bare "3" after the link is not.
              */}
              {waiting > 0 && (
                <>
                  <span
                    aria-hidden="true"
                    className="inline-flex min-w-5 items-center justify-center rounded-full bg-campfire px-1.5 py-0.5 text-xs font-semibold text-white"
                  >
                    {waiting > 99 ? "99+" : waiting}
                  </span>
                  <span className="sr-only">
                    , {waiting} waiting for an answer
                  </span>
                </>
              )}
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
          className="btn-secondary inline-flex whitespace-nowrap h-9 cursor-pointer items-center justify-center border border-white/20 px-4 text-sm font-medium text-white focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-offset-2 focus-visible:ring-offset-navy focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Signing out" : "Sign out"}
        </button>
      </div>
    </div>
  );
}
