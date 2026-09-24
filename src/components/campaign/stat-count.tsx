"use client";

import { useEffect, useRef, useState } from "react";

import { formatKES, formatKESCompact, formatNumber } from "@/lib/format";
import { onEnter, worthAnimating } from "@/lib/on-enter";

/** Short, because every figure on the page is arriving at once. */
const COUNT_MS = 280;

const FORMATS = {
  kes: (value: bigint) => formatKES(value),
  kesCompact: (value: bigint) => formatKESCompact(value),
  // A count of pledges or weeks, which is never money, so a number is safe.
  number: (value: bigint) => formatNumber(Number(value)),
};

/**
 * A figure on /progress that counts up the first time it comes into view.
 *
 * The server renders the final figure, so the first paint and a visitor without
 * JavaScript both read the true number. A figure below the fold is reset to
 * zero after hydration, which nobody sees because it is off screen, and counts
 * up when the shared observer reports it arriving. One already on screen at
 * hydration is left where it is, since counting it would flash the real figure,
 * then zero, then the count.
 *
 * The same ease out and the same integer arithmetic as the hero tracker: at
 * progress k out of 1000 the value is (to * k) / 1000 in bigint space, so money
 * is never held as a JavaScript number and the last frame is the exact figure.
 *
 * The value arrives as a string because it crosses from a server component.
 */
export function StatCount({
  value,
  format,
  suffix = "",
}: {
  value: string;
  format: keyof typeof FORMATS;
  suffix?: string;
}) {
  const to = BigInt(value);
  const [shown, setShown] = useState(to);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || !worthAnimating(element)) return;

    setShown(0n);
    let frame = 0;

    const stop = onEnter(element, () => {
      const start = performance.now();
      const step = (now: number) => {
        const linear = Math.min((now - start) / COUNT_MS, 1);
        const eased = 1 - (1 - linear) * (1 - linear);
        setShown((to * BigInt(Math.round(eased * 1000))) / 1000n);
        if (linear < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    });

    return () => {
      stop();
      cancelAnimationFrame(frame);
      setShown(to);
    };
  }, [to]);

  return (
    <span ref={ref}>
      {FORMATS[format](shown)}
      {suffix}
    </span>
  );
}
