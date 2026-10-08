"use client";

import { Share2 } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Shares a session.
 *
 * A real WhatsApp link, so it works with no script at all. On a phone with the
 * Web Share API the tap opens the system share sheet instead, which offers
 * WhatsApp along with everything else installed. A desktop browser with the
 * API keeps the link: a share sheet on a laptop is rarely where a church
 * member's contacts are.
 */
export function ShareSessionLink({
  whatsappUrl,
  title,
  text,
  className,
  children,
}: {
  whatsappUrl: string;
  title: string;
  text: string;
  className: string;
  children: ReactNode;
}) {
  async function onClick(event: React.MouseEvent<HTMLAnchorElement>) {
    const canShare =
      typeof navigator.share === "function" &&
      window.matchMedia("(pointer: coarse)").matches;
    if (!canShare) return;

    event.preventDefault();
    try {
      await navigator.share({ title, text });
    } catch (error) {
      // Dismissing the sheet is not a failure. Anything else falls back to
      // the WhatsApp link the anchor already points at.
      if (error instanceof DOMException && error.name === "AbortError") return;
      window.open(whatsappUrl, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <a
      href={whatsappUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      className={className}
    >
      <Share2 aria-hidden className="size-4" />
      {children}
    </a>
  );
}
