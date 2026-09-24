"use client";

import { useEffect } from "react";

/**
 * Two small physical toys, driven from one set of listeners on the document.
 *
 * `data-spring` marks a surface that can be pulled and let go: the hero tracker,
 * the verse under it and the road map cards on /vision. `data-tilt` marks a
 * card that leans toward the pointer: the figures on /progress. The attributes
 * are written by server components, so none of those surfaces has to become a
 * client component, and this is the only script either behaviour costs.
 *
 * Everything here writes inline transforms and nothing else. The stylesheet
 * owns the transitions, including the overshoot that makes a released card
 * bounce past home, so letting go is a matter of clearing the inline values.
 *
 * A mouse drags a spring surface. A finger never does: a finger on the hero has
 * to scroll the page, so on touch the surface only squashes under the press and
 * springs back, and the stylesheet keeps touch-action at pan-y throughout.
 */

/** Pointer distance to card distance. A third, so it feels tethered. */
const RESISTANCE = 1 / 3;

/** Furthest a spring surface travels on either axis, in pixels. */
const TRAVEL_PX = 40;

/** Roll at full travel, in degrees. */
const DRAG_TILT_DEG = 6;

/** Roll toward a finger on a spring surface, at the very edge. */
const SQUASH_TILT_DEG = 1.5;

/** Lean of a tilt card on each axis at its edge. */
const CARD_TILT_DEG = 8;

/** A drag starts past this much movement, so a click stays a click. */
const DRAG_THRESHOLD_PX = 4;

/** Links and controls inside a card keep their own press. */
const INTERACTIVE = "a, button, input, select, textarea, label, summary";

const clamp = (value: number, limit: number) =>
  Math.max(-limit, Math.min(limit, value));

/** Where a point sits on an element, -1 to 1 from its centre on each axis. */
function offsetFromCentre(element: HTMLElement, x: number, y: number) {
  // The centre of the bounding box does not move under a rotation or a scale
  // about the centre, and the half sizes come from the layout box, so a card
  // that is already leaning measures the same as a flat one.
  const rect = element.getBoundingClientRect();
  return {
    nx: clamp((x - (rect.left + rect.width / 2)) / (element.offsetWidth / 2), 1),
    ny: clamp((y - (rect.top + rect.height / 2)) / (element.offsetHeight / 2), 1),
  };
}

export function PointerMotion() {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const root = document.documentElement;

    let held: {
      element: HTMLElement;
      pointerId: number;
      startX: number;
      startY: number;
      mouse: boolean;
      dragging: boolean;
    } | null = null;

    let tilted: HTMLElement | null = null;

    // One write per frame however fast the pointer reports.
    let frame = 0;
    let pending: (() => void) | null = null;

    function schedule(write: () => void) {
      pending = write;
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        pending?.();
        pending = null;
      });
    }

    function cancelFrame() {
      cancelAnimationFrame(frame);
      frame = 0;
      pending = null;
    }

    function tilt(element: HTMLElement, x: number, y: number) {
      const { nx, ny } = offsetFromCentre(element, x, y);
      tilted = element;
      schedule(() => {
        element.dataset.tilting = "";
        element.style.transform = `perspective(800px) rotateX(${-ny * CARD_TILT_DEG}deg) rotateY(${nx * CARD_TILT_DEG}deg) scale(1.03)`;
        element.style.setProperty("--tilt-x", `${(nx + 1) * 50}%`);
        element.style.setProperty("--tilt-y", `${(ny + 1) * 50}%`);
      });
    }

    function flatten() {
      if (!tilted) return;
      cancelFrame();
      delete tilted.dataset.tilting;
      tilted.style.transform = "";
      tilted = null;
    }

    function release() {
      if (!held) return;
      const { element } = held;
      held = null;
      cancelFrame();
      delete element.dataset.held;
      delete root.dataset.dragging;
      element.style.translate = "";
      element.style.rotate = "";
      element.style.scale = "";
    }

    function onPointerDown(event: PointerEvent) {
      if (reduce.matches || event.button !== 0 || !event.isPrimary) return;
      const target = event.target as Element;
      if (target.closest(INTERACTIVE)) return;

      const mouse = event.pointerType === "mouse";

      const spring = target.closest<HTMLElement>("[data-spring]");
      if (spring) {
        release();
        held = {
          element: spring,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          mouse,
          dragging: false,
        };
        spring.dataset.held = "";

        if (!mouse) {
          const { nx } = offsetFromCentre(spring, event.clientX, event.clientY);
          spring.style.scale = "0.97";
          spring.style.rotate = `${nx * SQUASH_TILT_DEG}deg`;
        }
        return;
      }

      const card = target.closest<HTMLElement>("[data-tilt]");
      if (card && !mouse) tilt(card, event.clientX, event.clientY);
    }

    function onPointerMove(event: PointerEvent) {
      if (reduce.matches) return;

      if (held?.mouse && event.pointerId === held.pointerId) {
        const dx = event.clientX - held.startX;
        const dy = event.clientY - held.startY;

        if (!held.dragging) {
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          // From here the gesture is a drag, not a text selection. The page
          // stops selecting until release, and whatever the first few pixels
          // had begun to select is let go.
          held.dragging = true;
          root.dataset.dragging = "";
          window.getSelection()?.removeAllRanges();
        }

        const x = clamp(dx * RESISTANCE, TRAVEL_PX);
        const y = clamp(dy * RESISTANCE, TRAVEL_PX);
        const { element } = held;
        schedule(() => {
          element.style.translate = `${x}px ${y}px`;
          element.style.rotate = `${(x / TRAVEL_PX) * DRAG_TILT_DEG}deg`;
        });
        return;
      }

      if (event.pointerType !== "mouse" || held) return;

      const card = (event.target as Element).closest<HTMLElement>("[data-tilt]");
      if (card !== tilted) flatten();
      if (card) tilt(card, event.clientX, event.clientY);
    }

    function onPointerOut(event: PointerEvent) {
      if (
        event.pointerType === "mouse" &&
        tilted &&
        !tilted.contains(event.relatedTarget as Node | null)
      ) {
        flatten();
      }
    }

    function onPointerEnd(event: PointerEvent) {
      if (held && event.pointerId === held.pointerId) release();
      if (event.pointerType !== "mouse") flatten();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerout", onPointerOut);
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
    window.addEventListener("blur", release);

    return () => {
      release();
      flatten();
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerout", onPointerOut);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      window.removeEventListener("blur", release);
    };
  }, []);

  return null;
}
