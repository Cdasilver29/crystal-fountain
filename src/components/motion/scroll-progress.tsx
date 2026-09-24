"use client";

import { useEffect } from "react";

/**
 * The reading progress line across the top of the viewport.
 *
 * The CSS drives it from a scroll timeline wherever the browser has one, and
 * then this effect returns without doing anything. Only a browser without
 * scroll timelines gets the fallback: one passive scroll listener that asks
 * for at most one frame at a time and writes a single custom property.
 *
 * Nothing here for a visitor who has asked for less movement; the CSS removes
 * the line for them.
 */
export function ScrollProgress() {
  useEffect(() => {
    if (
      CSS.supports("animation-timeline: scroll()") ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const root = document.documentElement;
    let frame = 0;

    const update = () => {
      frame = 0;
      const range = root.scrollHeight - root.clientHeight;
      root.style.setProperty(
        "--scroll-progress",
        String(range > 0 ? root.scrollTop / range : 0),
      );
    };

    const onScroll = () => {
      frame ||= requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  return <div aria-hidden className="scroll-progress" />;
}
