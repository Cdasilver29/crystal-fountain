"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

/** Copies a value. Falls back to doing nothing loud if the clipboard is refused. */
export function CopyButton({
  value,
  label = "Copy reference",
  compact = false,
}: {
  value: string;
  label?: string;
  /** Small inline variant, for use beside a field in a list of details. */
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard access can be refused. Say nothing and leave the value on
      // screen, which is where it can always be read from.
    }
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={copy}
        aria-live="polite"
        aria-label={`Copy ${value}`}
        className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium text-denim underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
      >
        {copied ? "Copied" : label}
      </button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={copy}
      aria-live="polite"
      className="border-denim/30 text-navy"
    >
      {copied ? "Copied" : label}
    </Button>
  );
}
