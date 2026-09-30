"use client";

import { useEffect } from "react";

/**
 * Marks the page while its tab is hidden, so the looping CSS animation on the
 * home page (the hero line) pauses rather than running on unseen and picking up
 * mid move when the tab comes back. Renders nothing.
 */
export function PauseWhenHidden() {
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => root.toggleAttribute("data-tab-hidden", document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      root.removeAttribute("data-tab-hidden");
    };
  }, []);

  return null;
}
