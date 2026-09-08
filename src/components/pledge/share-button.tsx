"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Shares the pledge link.
 *
 * Uses the Web Share API where it exists, which on an Android phone opens the
 * WhatsApp share sheet directly. Everywhere else it copies the link instead, so
 * the button always does something useful.
 */
export function ShareButton({ url, title }: { url: string; title: string }) {
  const [state, setState] = useState<"idle" | "copied">("idle");

  useEffect(() => {
    if (state !== "copied") return;
    const timer = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  async function share() {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // The sheet was dismissed, or sharing is not permitted here. Fall
        // through to the clipboard.
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      // Nothing further to try. The link is visible on the page.
    }
  }

  return (
    <Button
      type="button"
      onClick={share}
      aria-live="polite"
      className="bg-denim text-white hover:bg-denim/90"
    >
      {state === "copied" ? "Link copied" : "Share"}
    </Button>
  );
}
