/**
 * One IntersectionObserver for the whole page, shared by every entrance.
 *
 * The section reveals on the home page and the figures counting up on
 * /progress each register an element and a callback here rather than building
 * an observer of their own, so a page with twenty elements waiting to arrive
 * still has one observer running.
 *
 * Each callback fires once. The element is unobserved before its callback runs,
 * because an entrance that replayed on the way back up the page would make
 * somebody watch the same section arrive twice.
 */

const waiting = new Map<Element, () => void>();
let observer: IntersectionObserver | undefined;

/**
 * Whether an element is worth an entrance at all.
 *
 * Not for a visitor who has asked for less movement, and not without an
 * observer to end it. And only for an element below the fold: one already on
 * screen when the page hydrates has been seen in its final state, and hiding
 * it to play an entrance would be a flash, not an arrival. One already
 * scrolled past is left alone for the same reason.
 */
export function worthAnimating(element: Element): boolean {
  return (
    typeof IntersectionObserver !== "undefined" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
    element.getBoundingClientRect().top > window.innerHeight
  );
}

export function onEnter(element: Element, callback: () => void): () => void {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const run = waiting.get(entry.target);
        waiting.delete(entry.target);
        observer?.unobserve(entry.target);
        run?.();
      }
    },
    // A little below the bottom edge, so the entrance has already started by
    // the time the element scrolls into view and nobody sees it begin.
    { rootMargin: "0px 0px 8% 0px" },
  );

  waiting.set(element, callback);
  observer.observe(element);

  return () => {
    waiting.delete(element);
    observer?.unobserve(element);
  };
}
