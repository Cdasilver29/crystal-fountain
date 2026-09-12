"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Shares the pledge link.
 *
 * Uses the Web Share API where it exists, which on an Android phone opens the
 * WhatsApp share sheet directly. Everywhere else it copies the link instead, so
 * the button always does something useful.
 *
 * The url carries the card: WhatsApp fetches the og:image from /p/<token> and
 * draws it into the conversation, so the picture is not attached here and there
 * is nothing to upload. The text is what somebody reads underneath it.
 */
export function ShareButton({
  url,
  title,
  text,
  label = "Share",
}: {
  url: string;
  title: string;
  /**
   * The message body. Optional, because the two callers that share a pledge
   * pass one and anything else sharing a plain link does not need one.
   */
  text?: string;
  /** The button's own text. The confirmation says what is being shared. */
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "copied">("idle");

  useEffect(() => {
    if (state !== "copied") return;
    const timer = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  async function share() {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title, text, url });
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
      {state === "copied" ? "Link copied" : label}
    </Button>
  );
}
