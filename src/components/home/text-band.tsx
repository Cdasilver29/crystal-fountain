"use client";

import { useEffect, useRef } from "react";

import { MOTION_PAUSED } from "@/components/motion/motion-toggle";
import { TEXT_BAND_WORDS } from "@/content/home";

/*
 * One copy of the words, run twice over so a copy is wider than a 1920px
 * window. The band moves by exactly one copy before it wraps, which is the
 * same picture, so the loop has no seam in either direction.
 */
const RUN = [...TEXT_BAND_WORDS, ...TEXT_BAND_WORDS];

/** The drift, in pixels a second. */
const SPEED = 35;

/**
 * A slow band of words between the commitment section and the timeline.
 *
 * Texture rather than a headline: the serif large and faint on navy, drifting
 * left on its own. A drag or a swipe moves it either way, back from left to
 * right as well, and it drifts on from wherever it was let go. It stops under
 * the mouse, and with the pause switch in the hero or beside the brochure.
 * One requestAnimationFrame loop writes one transform, and only
 * while the band is on screen; a hidden tab gets no frames. Under reduced
 * motion it does not drift, but can still be dragged.
 *
 * The first copy is read once by a screen reader and every repeat is hidden
 * from it.
 */
export function TextBand() {
  const bandRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const band = bandRef.current;
    const track = trackRef.current;
    if (!band || !track) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

    let x = 0;
    let width = 1;
    let last = 0;
    let frame = 0;
    let over = false;
    let held = false;
    let dragged = false;
    let startX = 0;
    let startOffset = 0;

    const measure = () => {
      width = (track.firstElementChild as HTMLElement).offsetWidth || 1;
    };
    const place = () => {
      // Kept between one copy to the left and none, whichever way it moved.
      x = ((x % width) - width) % width || 0;
      track.style.transform = `translate3d(${x}px, 0, 0)`;
    };

    const tick = (time: number) => {
      const paused = document.documentElement.hasAttribute(MOTION_PAUSED);
      if (last && !still && !over && !held && !paused) {
        x -= (SPEED * Math.min(time - last, 50)) / 1000;
      }
      last = time;
      place();
      frame = requestAnimationFrame(tick);
    };

    const down = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      held = true;
      dragged = false;
      startX = event.clientX;
      startOffset = x;
    };
    const move = (event: PointerEvent) => {
      if (!held) return;
      const dx = event.clientX - startX;
      if (!dragged && Math.abs(dx) < 6) return;
      if (!dragged) {
        dragged = true;
        band.setPointerCapture(event.pointerId);
        band.dataset.dragging = "";
      }
      x = startOffset + dx;
      place();
    };
    const up = () => {
      held = false;
      delete band.dataset.dragging;
    };
    const enter = (event: PointerEvent) => {
      if (event.pointerType === "mouse") over = true;
    };
    const leave = () => (over = false);

    const observer = new IntersectionObserver(([entry]) => {
      cancelAnimationFrame(frame);
      last = 0;
      if (entry.isIntersecting) frame = requestAnimationFrame(tick);
    });

    measure();
    void document.fonts?.ready.then(measure);
    window.addEventListener("resize", measure);
    observer.observe(band);
    band.addEventListener("pointerdown", down);
    band.addEventListener("pointermove", move);
    band.addEventListener("pointerup", up);
    band.addEventListener("pointercancel", up);
    band.addEventListener("pointerenter", enter);
    band.addEventListener("pointerleave", leave);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      band.removeEventListener("pointerdown", down);
      band.removeEventListener("pointermove", move);
      band.removeEventListener("pointerup", up);
      band.removeEventListener("pointercancel", up);
      band.removeEventListener("pointerenter", enter);
      band.removeEventListener("pointerleave", leave);
    };
  }, []);

  return (
    <div
      ref={bandRef}
      className="text-band overflow-x-clip border-y border-white/5 bg-navy py-3 sm:py-4"
    >
      <div ref={trackRef} className="flex w-max">
        <Copy />
        <Copy hidden />
      </div>
    </div>
  );
}

function Copy({ hidden = false }: { hidden?: boolean }) {
  return (
    <p
      aria-hidden={hidden || undefined}
      className="font-display flex shrink-0 text-2xl leading-8 font-semibold whitespace-nowrap text-white/15 sm:text-3xl sm:leading-9"
    >
      {RUN.map((word, index) => (
        <span
          key={index}
          aria-hidden={index >= TEXT_BAND_WORDS.length || undefined}
        >
          {word}
          <span aria-hidden className="px-4 sm:px-5">
            ·
          </span>
        </span>
      ))}
    </p>
  );
}
