"use client";

import { useEffect, useRef, type ReactNode, type SyntheticEvent } from "react";

/** Per tab, so a member who opened the list sees it open again on return. */
const STORAGE_KEY = "cf-all-levels";

/**
 * The six commitment levels behind "See all nine levels".
 *
 * A details element, so opening it is the browser's job rather than this
 * component's. With JavaScript blocked the summary still opens the list, and
 * a closed details keeps its content out of the tab order and the
 * accessibility tree without an inert attribute to manage. The levels are
 * rendered on the server and handed in as children.
 *
 * The height transition is the .more-levels rule in globals.css, animating
 * ::details-content to auto. A browser that does not know the pseudo element
 * drops the rule and simply opens the list at once.
 *
 * One way only. The summary is hidden once the list is open, so it cannot be
 * closed again, and this component remembers it for the rest of the session.
 * That memory is the only thing that needs JavaScript. sessionStorage can be
 * missing or throw in a private window, which only means the list starts
 * collapsed again.
 */
export function MoreLevels({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  // Whether the summary had focus when it was activated. Read on click rather
  // than on toggle, because toggle fires after the open state has hidden the
  // summary, and by then focus has already fallen back to the page.
  const handFocus = useRef(false);

  useEffect(() => {
    const details = ref.current;
    if (!details) return;
    try {
      if (sessionStorage.getItem(STORAGE_KEY) === "1") {
        // Already open as far as the reader is concerned, so it opens without
        // sliding. The marker comes off once the open state has been drawn:
        // two frames, because a single one runs before the style change it is
        // waiting for.
        details.dataset.restored = "";
        details.open = true;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => delete details.dataset.restored),
        );
      }
    } catch {
      // No storage, no memory. The list simply starts collapsed.
    }
  }, []);

  function onToggle(event: SyntheticEvent<HTMLDetailsElement>) {
    const details = event.currentTarget;
    if (!details.open) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // As above.
    }
    // The summary that had focus has just been hidden. Hand focus to the first
    // level so a keyboard user carries on from where they were, not from the
    // top of the page. On the next frame, because when toggle fires the
    // content has not been rendered yet and focus() on a link inside it is
    // silently refused.
    if (handFocus.current) {
      handFocus.current = false;
      requestAnimationFrame(() =>
        details.querySelector<HTMLElement>("a")?.focus({ preventScroll: true }),
      );
    }
  }

  return (
    <details
      ref={ref}
      id={id}
      onToggle={onToggle}
      // Widened by the focus ring's width on each side, with the content padded
      // back in, because ::details-content clips while it animates and would
      // otherwise cut the ring off a card at the edge.
      className="more-levels group/more -mx-1"
    >
      <summary
        onClick={(event) => {
          handFocus.current = document.activeElement === event.currentTarget;
        }}
        className="mx-1 mt-6 inline-flex h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-1 text-sm font-medium text-white/80 underline-offset-4 transition-colors group-open/more:hidden hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none [&::-webkit-details-marker]:hidden"
      >
        {label}
        <span aria-hidden>&darr;</span>
      </summary>
      <div className="px-1 pt-3 pb-1">{children}</div>
    </details>
  );
}
