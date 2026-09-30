"use client";

import { useEffect, useState } from "react";

/**
 * Set on the html element while the visitor has paused the home page's
 * motion. The brochure ring and the text band check it every frame and the
 * hero line's CSS animation pauses on it.
 */
export const MOTION_PAUSED = "data-motion-paused";

const STORAGE_KEY = "cf-motion-paused";
const CHANGED = "cf-motion-changed";

/**
 * A pause and play switch for everything on the home page that moves by
 * itself: the hero line, the text band and the brochure ring. Anything that
 * moves for more than five seconds beside other content needs one, and hover
 * or touch is not enough for somebody on a keyboard or a screen magnifier.
 *
 * One setting on the html element, so the one button, beside the brochure,
 * pauses the hero line and the text band as well. It is remembered in this
 * browser only, a per-visitor convenience, and read in a try because storage
 * can be blocked.
 * Hidden under reduced motion, where nothing moves by itself to pause.
 */
export function MotionToggle({ className = "" }: { className?: string }) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") {
        root.setAttribute(MOTION_PAUSED, "");
      }
    } catch {}
    const sync = () => setPaused(root.hasAttribute(MOTION_PAUSED));
    sync();
    window.addEventListener(CHANGED, sync);
    return () => window.removeEventListener(CHANGED, sync);
  }, []);

  const toggle = () => {
    const root = document.documentElement;
    const next = !root.hasAttribute(MOTION_PAUSED);
    root.toggleAttribute(MOTION_PAUSED, next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {}
    window.dispatchEvent(new Event(CHANGED));
  };

  return (
    <button
      type="button"
      aria-pressed={paused}
      title={paused ? "Play motion" : "Pause motion"}
      onClick={toggle}
      className={`motion-toggle flex items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none ${className}`}
    >
      <span className="sr-only">Pause motion</span>
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden
        className="size-4"
      >
        {paused ? (
          <path d="M8 5.5v13l10.5-6.5z" />
        ) : (
          <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
        )}
      </svg>
    </button>
  );
}
