"use client";

import { useState } from "react";

/**
 * Who is signed in, and the way out.
 *
 * Sits in the admin header. The role is shown next to the name because it is
 * the thing that decides what the screen will let this person do, and a
 * treasurer wondering why the approve button refuses should not have to guess.
 */
export function AdminBar({ name, role }: { name: string; role: string }) {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } catch {
      // Going to the login screen anyway. The cookie is httpOnly and the
      // server is the only thing that can clear it, so if the request did not
      // land the login screen will simply not treat them as signed out.
    }
    // A full navigation, so the server reads the cleared cookie rather than a
    // cached RSC payload.
    window.location.assign("/admin/login");
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-white/70">
        Signed in as <span className="font-medium text-white">{name}</span>
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
  );
}
