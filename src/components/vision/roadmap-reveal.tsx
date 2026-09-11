"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The one piece of the road map that needs the client: a single
 * IntersectionObserver that reports when the section has been scrolled to.
 *
 * It wraps server rendered children rather than owning the markup, so the six
 * cards, their icons and their copy stay on the server and none of it is
 * shipped as JavaScript. All this component contributes to the bundle is the
 * observer below.
 *
 * The attribute it toggles drives every animation from CSS:
 *
 *   armed  the section has not been reached yet, cards hidden, line undrawn
 *   shown  it has, so the staggered entrance and the line draw both run
 *
 * "armed" is what the server renders, so the first client render matches it and
 * there is no hydration mismatch and no flash of the cards before they animate.
 * Both states are inert under prefers-reduced-motion, where the rules that read
 * the attribute are not applied at all.
 *
 * The observer disconnects on the first intersection. This is an entrance, not
 * a scroll linked effect, and a card that faded out again on the way back up
 * would be a card somebody has to scroll to twice to read.
 */
export function RoadmapReveal({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const element = ref.current;

    // No element or no observer support: show it. Nothing here is worth
    // withholding the content of the section over.
    if (!element || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setShown(true);
        observer.disconnect();
      },
      // A little past the bottom edge, so the first card is properly on screen
      // when it starts rather than animating in the corner of the viewport.
      { rootMargin: "0px 0px -12% 0px" },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      data-roadmap={shown ? "shown" : "armed"}
      className={className}
    >
      {children}
    </div>
  );
}
