"use client";

import { useEffect } from "react";

import { onEnter, worthAnimating } from "@/lib/on-enter";

/**
 * Arms the section reveals on the page it is mounted in.
 *
 * Renders nothing. The sections stay server components and carry a bare
 * data-reveal attribute, which the CSS treats as finished: opaque and in place.
 * That is what the server sends and what a visitor without JavaScript keeps, so
 * the reveal can only ever add an entrance, never withhold the content.
 *
 * After hydration each marked element still below the fold is set to "armed",
 * which hides it, and handed to the shared observer, which sets "shown" as it
 * approaches the viewport and the CSS runs the entrance. Everything about the
 * motion itself is in globals.css; this only moves the attribute.
 */
export function RevealOnScroll() {
  useEffect(() => {
    const stops: (() => void)[] = [];

    for (const element of document.querySelectorAll<HTMLElement>(
      "[data-reveal]",
    )) {
      if (!worthAnimating(element)) continue;
      element.dataset.reveal = "armed";
      stops.push(onEnter(element, () => (element.dataset.reveal = "shown")));
    }

    // Leaving the page before reaching a section must not strand it hidden
    // should the same node be kept, so anything still armed is put back.
    return () => {
      for (const stop of stops) stop();
      for (const element of document.querySelectorAll<HTMLElement>(
        '[data-reveal="armed"]',
      )) {
        element.dataset.reveal = "";
      }
    };
  }, []);

  return null;
}
