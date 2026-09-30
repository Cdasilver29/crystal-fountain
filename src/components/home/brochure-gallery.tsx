"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { FadeImage } from "@/components/media/fade-image";
import { MOTION_PAUSED, MotionToggle } from "@/components/motion/motion-toggle";
import {
  BROCHURE_HEIGHT,
  BROCHURE_PAGES,
  BROCHURE_WIDTH,
} from "@/content/brochure";

const LAST = BROCHURE_PAGES.length - 1;

/** The angle between neighbouring pages on the ring. */
const STEP = 360 / BROCHURE_PAGES.length;

/** The ring's own turn, in degrees a millisecond: once round in 45s. */
const DRIFT = 360 / 45000;

/** How long the ring rests after a hand has let go of it. */
const REST = 2500;

/*
 * Where a page sits on the ring at a given turn. The pages go round a circle
 * seen from a little above, always facing the reader: sideways by the sine,
 * and smaller, fainter and further back by the cosine. Written as custom
 * properties for the CSS to place, and used on the server too, so the first
 * paint is the ring at rest with page one in front.
 */
function placement(angle: number, index: number) {
  const theta = ((angle + index * STEP) * Math.PI) / 180;
  const depth = (Math.cos(theta) + 1) / 2;
  return {
    "--x": Math.sin(theta).toFixed(4),
    "--s": (0.55 + 0.45 * depth).toFixed(4),
    "--d": depth.toFixed(4),
    opacity: (0.3 + 0.7 * depth).toFixed(3),
    zIndex: Math.round(depth * 100),
  };
}

/**
 * The printed trifold, as a ring of pages that turns, with a detail panel.
 *
 * The five pages go round a circle and the ring turns slowly on its own.
 * A touch, the mouse over it or the pause switch stops it, and a drag spins it either way, one
 * page for a card's width of travel. Let go and it carries on for a moment,
 * rests, and then turns again in whichever direction it was last spun. The
 * arrows turn it a page at a time, and a card that takes keyboard focus is
 * brought round to the front. Pages on the far side fade back so the front one
 * reads first.
 *
 * The turning is one requestAnimationFrame loop placing five cards, and it
 * only runs while the ring is on screen; a hidden tab gets no frames at all.
 * Under reduced motion the ring does not turn by itself, and the arrows and
 * focus move it at once rather than gliding.
 *
 * Without script the ring still stands, page one at the front, and every page
 * is a button that opens nothing. That is the static first paint too.
 *
 * A card opens one native dialog. It is modal, so the page behind is inert and
 * Escape closes it without a listener here; the arrow keys move between pages,
 * and focus goes back to the card that opened it.
 *
 * The source scans are 1688x2000 and roughly 300kB each, so every image goes
 * through next/image with an explicit sizes hint.
 */
export function BrochureGallery() {
  const stageRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLUListElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  // Set by the effect, so the arrows and the panel can steer the ring.
  const turnRef = useRef<(to: "next" | "previous" | number) => void>(() => {});
  const holdRef = useRef<(held: boolean) => void>(() => {});
  const [shown, setShown] = useState(0);
  const page = BROCHURE_PAGES[shown];

  useEffect(() => {
    const stage = stageRef.current;
    const ring = ringRef.current;
    if (!stage || !ring) return;
    const slots = [...ring.children] as HTMLElement[];
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

    let angle = 0;
    let direction = -1;
    let fling = 0;
    let target: number | null = null;
    let resumeAt = 0;
    let last = 0;
    let frame = 0;
    // Reasons to hold still: a pointer on it, a hand on it, focus in it, or
    // the panel open over it.
    const holds = { over: false, hand: false, focus: false, panel: false };

    const apply = () => {
      ring.dataset.angle = angle.toFixed(2);
      slots.forEach((slot, index) => {
        const place = placement(angle, index);
        slot.style.setProperty("--x", place["--x"]);
        slot.style.setProperty("--s", place["--s"]);
        slot.style.setProperty("--d", place["--d"]);
        slot.style.opacity = place.opacity;
        slot.style.zIndex = String(place.zIndex);
      });
    };

    const tick = (time: number) => {
      const dt = last ? Math.min(time - last, 50) : 0;
      last = time;
      if (holds.hand) {
        // The drag places the ring itself.
      } else if (target !== null) {
        angle += (target - angle) * Math.min(1, dt / 110);
        if (Math.abs(target - angle) < 0.05) {
          angle = target;
          target = null;
        }
      } else if (fling) {
        angle += fling * dt;
        fling *= Math.pow(0.94, dt / 16);
        if (Math.abs(fling) < DRIFT) fling = 0;
      } else if (
        !still &&
        !Object.values(holds).some(Boolean) &&
        !document.documentElement.hasAttribute(MOTION_PAUSED) &&
        time >= resumeAt
      ) {
        angle += direction * DRIFT * dt;
      }
      apply();
      frame = requestAnimationFrame(tick);
    };

    const rest = () => (resumeAt = performance.now() + REST);

    // The same page, reached by the shortest way round from where it is now.
    const nearest = (to: number) => to + 360 * Math.round((angle - to) / 360);

    turnRef.current = (to) => {
      if (typeof to === "number") {
        target = nearest(-to * STEP);
      } else {
        direction = to === "next" ? -1 : 1;
        target = Math.round(angle / STEP) * STEP + direction * STEP;
      }
      fling = 0;
      rest();
      if (still) {
        angle = target;
        target = null;
        apply();
      }
    };
    holdRef.current = (held) => {
      holds.panel = held;
      if (!held) rest();
    };

    let startX = 0;
    let startAngle = 0;
    let lastX = 0;
    let lastTime = 0;
    let speed = 0;
    let dragged = false;

    const down = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      holds.hand = true;
      dragged = false;
      target = null;
      fling = 0;
      startX = lastX = event.clientX;
      lastTime = event.timeStamp;
      startAngle = angle;
      speed = 0;
    };

    const move = (event: PointerEvent) => {
      if (!holds.hand) return;
      const dx = event.clientX - startX;
      // A few pixels of wobble is still a tap.
      if (!dragged && Math.abs(dx) < 6) return;
      if (!dragged) {
        dragged = true;
        stage.setPointerCapture(event.pointerId);
        stage.dataset.dragging = "";
      }
      // One page for a card's width of travel.
      const perPixel = STEP / (slots[0]?.offsetWidth || 240);
      angle = startAngle + dx * perPixel;
      const dt = event.timeStamp - lastTime;
      if (dt > 0) speed = ((event.clientX - lastX) * perPixel) / dt;
      lastX = event.clientX;
      lastTime = event.timeStamp;
    };

    const up = () => {
      if (!holds.hand) return;
      holds.hand = false;
      delete stage.dataset.dragging;
      if (dragged) {
        // Carry on the way it was spun, and keep turning that way after.
        fling = still ? 0 : Math.max(-0.5, Math.min(0.5, speed));
        if (Math.abs(speed) > DRIFT) direction = Math.sign(speed);
      }
      rest();
    };

    // The click that ends a drag is not a request to open the card under it.
    const click = (event: MouseEvent) => {
      if (!dragged) return;
      dragged = false;
      event.preventDefault();
      event.stopPropagation();
    };

    const enter = (event: PointerEvent) => {
      if (event.pointerType === "mouse") holds.over = true;
    };
    const leave = () => {
      holds.over = false;
      rest();
    };

    // Keyboard focus only: a mouse press focuses the card too, and that is a
    // drag or a click, not a request to bring the card round and hold it.
    const focusIn = (event: FocusEvent) => {
      const card = event.target as Element;
      if (!card.matches(":focus-visible")) return;
      holds.focus = true;
      const slot = card.closest("li");
      if (slot) turnRef.current(slots.indexOf(slot as HTMLElement));
    };
    const focusOut = () => {
      holds.focus = false;
      rest();
    };

    // Only turn while the ring can be seen.
    const observer = new IntersectionObserver(([entry]) => {
      cancelAnimationFrame(frame);
      last = 0;
      if (entry.isIntersecting) frame = requestAnimationFrame(tick);
    });
    observer.observe(stage);

    stage.addEventListener("pointerdown", down);
    stage.addEventListener("pointermove", move);
    stage.addEventListener("pointerup", up);
    stage.addEventListener("pointercancel", up);
    stage.addEventListener("pointerenter", enter);
    stage.addEventListener("pointerleave", leave);
    stage.addEventListener("click", click, true);
    stage.addEventListener("focusin", focusIn);
    stage.addEventListener("focusout", focusOut);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      stage.removeEventListener("pointerdown", down);
      stage.removeEventListener("pointermove", move);
      stage.removeEventListener("pointerup", up);
      stage.removeEventListener("pointercancel", up);
      stage.removeEventListener("pointerenter", enter);
      stage.removeEventListener("pointerleave", leave);
      stage.removeEventListener("click", click, true);
      stage.removeEventListener("focusin", focusIn);
      stage.removeEventListener("focusout", focusOut);
    };
  }, []);

  const open = (index: number, opener: HTMLButtonElement) => {
    openerRef.current = opener;
    holdRef.current(true);
    setShown(index);
    dialogRef.current?.showModal();
  };

  const go = (index: number) => setShown(Math.min(LAST, Math.max(0, index)));

  return (
    <section className="bg-[#f8f7f5] page-gutter section">
      <div className="container-marketing">
        <div className="flex items-end justify-between gap-4">
          <h2
            data-reveal=""
            className="font-display text-xl font-semibold text-balance text-navy sm:text-3xl"
          >
            What we are building, in five pages
          </h2>

          <div className="flex shrink-0 gap-2">
            <MotionToggle className="size-10 border border-navy/15 bg-white text-navy shadow-sm transition-colors hover:bg-neutral-100" />
            <RoundButton
              label="Turn to the previous page"
              disabled={false}
              onClick={() => turnRef.current("previous")}
              path="M15 18l-6-6 6-6"
            />
            <RoundButton
              label="Turn to the next page"
              disabled={false}
              onClick={() => turnRef.current("next")}
              path="M9 18l6-6-6-6"
            />
          </div>
        </div>

        <div ref={stageRef} data-reveal="" className="brochure-stage mt-5">
          <ul ref={ringRef} aria-label="Brochure pages">
            {BROCHURE_PAGES.map((card, index) => (
              <li
                key={card.src}
                style={placement(0, index) as React.CSSProperties}
                className="brochure-slot"
              >
                <button
                  type="button"
                  aria-haspopup="dialog"
                  onClick={(event) => open(index, event.currentTarget)}
                  className="brochure-card group block w-full rounded-2xl text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-campfire"
                >
                  {/*
                    The page's contents are in the panel as text and in its alt
                    text there, so the small copy here is decoration.
                  */}
                  <span className="block overflow-hidden rounded-2xl border border-black/5 bg-white shadow-elevate group-hover:shadow-elevate-lg">
                    <FadeImage
                      src={card.src}
                      alt=""
                      width={BROCHURE_WIDTH}
                      height={BROCHURE_HEIGHT}
                      loading="lazy"
                      draggable={false}
                      sizes="(min-width: 1024px) 240px, (min-width: 640px) 220px, 180px"
                      className="h-auto w-full"
                    />
                  </span>
                  <span className="brochure-caption mt-2 block px-1 text-sm font-semibold text-navy sm:text-base">
                    {card.title}
                  </span>
                  <span className="brochure-caption tabular block px-1 text-xs text-neutral-500 sm:text-sm">
                    Page {index + 1} of {BROCHURE_PAGES.length}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-3 text-sm text-neutral-500">
          Five pages from the printed brochure. Drag to turn them either way, or
          select one to read what it covers.
        </p>
      </div>

      {/*
        Full screen on a phone, the page above its text; a centred panel with
        the page beside the text from the medium breakpoint up. A click on the
        backdrop lands on the dialog itself, since the content fills it, and
        closes it.
      */}
      <dialog
        ref={dialogRef}
        aria-labelledby="brochure-panel-title"
        onClose={() => {
          holdRef.current(false);
          openerRef.current?.focus();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialogRef.current?.close();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") go(shown + 1);
          if (event.key === "ArrowLeft") go(shown - 1);
        }}
        className="brochure-panel m-0 h-full max-h-none w-full max-w-none overflow-y-auto bg-white p-0 text-neutral-800 backdrop:bg-black/70 md:m-auto md:h-auto md:max-h-[90vh] md:w-[min(64rem,calc(100%-3rem))] md:rounded-2xl"
      >
        <div className="relative grid md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <button
            type="button"
            aria-label="Close"
            onClick={() => dialogRef.current?.close()}
            className="absolute top-3 right-3 z-10 flex size-10 items-center justify-center rounded-full bg-white/90 text-navy shadow-md transition-colors hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
          >
            <Icon path="M6 6l12 12M18 6L6 18" />
          </button>

          <div className="flex items-center justify-center bg-[#f8f7f5] p-4 md:p-6">
            <FadeImage
              key={page.src}
              src={page.src}
              alt={page.alt}
              width={BROCHURE_WIDTH}
              height={BROCHURE_HEIGHT}
              sizes="(min-width: 768px) 440px, 100vw"
              className="h-auto max-h-[70svh] w-auto max-w-full object-contain md:max-h-[calc(90vh-3rem)]"
            />
          </div>

          <div className="flex flex-col p-5 sm:p-8">
            <p className="tabular text-sm text-neutral-500">
              Page {shown + 1} of {BROCHURE_PAGES.length}
            </p>
            <h2
              id="brochure-panel-title"
              className="font-display mt-1 pr-10 text-2xl font-semibold text-balance text-navy"
            >
              {page.title}
            </h2>
            <p className="mt-3 text-base leading-relaxed text-neutral-700">
              {page.summary}
            </p>

            <h3 className="mt-6 text-sm font-semibold text-navy">
              What this page covers
            </h3>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-base leading-relaxed text-neutral-700 marker:text-campfire">
              {page.covers.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>

            <div className="mt-auto flex flex-wrap items-center gap-3 pt-8">
              <Link
                href="/pledge"
                className="btn-primary cta-sweep inline-flex h-11 items-center justify-center bg-campfire px-6 text-base font-semibold text-white focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                Make a pledge
              </Link>

              <div className="ml-auto flex gap-2">
                <RoundButton
                  label="Previous page"
                  disabled={shown === 0}
                  onClick={() => go(shown - 1)}
                  path="M15 18l-6-6 6-6"
                />
                <RoundButton
                  label="Next page"
                  disabled={shown === LAST}
                  onClick={() => go(shown + 1)}
                  path="M9 18l6-6-6-6"
                />
              </div>
            </div>
          </div>
        </div>
      </dialog>
    </section>
  );
}

function RoundButton({
  label,
  disabled,
  onClick,
  path,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  path: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-10 items-center justify-center rounded-full border border-navy/15 bg-white text-navy shadow-sm transition-colors hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none disabled:cursor-default disabled:opacity-40 disabled:hover:bg-white"
    >
      <Icon path={path} />
    </button>
  );
}

function Icon({ path }: { path: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="size-5"
    >
      <path d={path} />
    </svg>
  );
}
