"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

/** Copies the reference. Falls back to selecting nothing rather than failing loudly. */
export function CopyButton({
  value,
  label = "Copy reference",
}: {
  value: string;
  label?: string;
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
      // Clipboard access can be refused. Say nothing and leave the reference
      // on screen, which is where it can always be read from.
    }
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
