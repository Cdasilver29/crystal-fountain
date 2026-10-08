"use client";

import { useEffect, useState } from "react";

/**
 * Copies an email address, for the people for whom a mailto link opens
 * nothing: webmail in a browser with no mail handler set.
 *
 * Plain classes rather than the shared Button, which imports cn and would
 * bring tailwind-merge onto a page that otherwise ships none.
 */
export function CopyEmailButton({ email }: { email: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
    } catch {
      // Clipboard access can be refused. The address stays on screen.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? `Copied ${email}` : `Copy ${email}`}
      className="btn-secondary inline-flex h-8 shrink-0 items-center rounded-lg border border-denim/30 bg-white px-3 text-sm font-medium text-navy focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
    >
      <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
