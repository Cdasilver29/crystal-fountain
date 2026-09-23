"use client";

import { useEffect, useState, type ReactNode } from "react";

/** Per tab, so a member who opened the list sees it open again on return. */
const STORAGE_KEY = "cf-all-levels";

/**
 * The six commitment levels behind "See all nine levels".
 *
 * The levels are rendered on the server and handed in as children, so they are
 * in the HTML from the start and this component carries nothing but the
 * toggle. Collapsed, they sit in a zero height grid row and are inert, so a
 * keyboard cannot tab into cards nobody can see. The height transition is the
 * grid row going from 0fr to 1fr, which animates to the content's real height
 * without measuring it.
 *
 * One way only. Once opened the list stays open for the rest of the session,
 * so the button goes away rather than turning into a "show fewer".
 *
 * sessionStorage can be missing or throw in a private window, which only means
 * the list starts collapsed again. Nothing depends on it.
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
  const [open, setOpen] = useState(false);
  // A list restored from storage opens without the animation. It was already
  // open as far as the reader is concerned; sliding it open again is noise.
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(STORAGE_KEY) === "1") setOpen(true);
    } catch {
      // No storage, no memory. The list simply starts collapsed.
    }
  }, []);

  function expand() {
    setAnimate(true);
    setOpen(true);
    try {
      sessionStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // As above.
    }
  }

  return (
    <>
      <div
        id={id}
        inert={!open}
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
        className={`-mx-1 grid ${animate ? "transition-[grid-template-rows] duration-500 ease-out motion-reduce:transition-none" : ""}`}
      >
        {/*
          The clip is what hides the collapsed row, and it would also clip the
          focus ring on a card at the edge. The row is widened by the ring's
          width on each side and the content padded back in, so the cards line
          up with the ones above and their rings still have room.
        */}
        <div className="min-h-0 overflow-hidden">
          <div className="px-1 pt-3 pb-1">{children}</div>
        </div>
      </div>

      {!open && (
        <button
          type="button"
          aria-expanded={false}
          aria-controls={id}
          onClick={expand}
          className="mt-6 inline-flex h-11 items-center gap-2 rounded-lg px-1 text-sm font-medium text-white/80 underline-offset-4 transition-colors hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
        >
          {label}
          <span aria-hidden>&darr;</span>
        </button>
      )}
    </>
  );
}
