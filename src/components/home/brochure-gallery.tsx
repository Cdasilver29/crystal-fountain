"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { FadeImage } from "@/components/media/fade-image";
import {
  BROCHURE_HEIGHT,
  BROCHURE_PAGES,
  BROCHURE_WIDTH,
} from "@/content/brochure";

const LAST = BROCHURE_PAGES.length - 1;

/** The gap between cards, gap-4, which a step of the track has to include. */
const GAP = 16;

/**
 * The printed trifold, as a row of cards with a detail panel.
 *
 * The row is a native scroller with mandatory snapping, so a thumb swipes it
 * and a trackpad scrolls it with nothing added. A mouse gets a drag on top:
 * snapping is switched off while the button is held, and on release the row
 * carries on for about 300ms of the release speed, at most a card further, and
 * settles on the nearest card. The row stays inside the container and the next card is cut at its
 * edge, which is what says there is more.
 *
 * A card opens one native dialog. It is modal, so the page behind is inert and
 * Escape closes it without a listener here; the arrow keys move between pages,
 * and focus goes back to the card that opened it.
 *
 * The source scans are 1688x2000 and roughly 300kB each, so every image goes
 * through next/image with an explicit sizes hint.
 */
export function BrochureGallery() {
  const trackRef = useRef<HTMLUListElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [shown, setShown] = useState(0);
  const page = BROCHURE_PAGES[shown];

  const sync = () => {
    const track = trackRef.current;
    if (!track) return;
    const { scrollLeft, scrollWidth, clientWidth } = track;
    setAtStart(scrollLeft <= 4);
    setAtEnd(scrollLeft >= scrollWidth - clientWidth - 4);
    // How much of the row has come into view, so the bar starts part full
    // and fills as the last card arrives.
    barRef.current?.style.setProperty(
      "transform",
      `scaleX(${(scrollLeft + clientWidth) / scrollWidth})`,
    );
  };

  const step = () =>
    (trackRef.current?.querySelector("li")?.offsetWidth ?? 280) + GAP;

  const behavior = (): ScrollBehavior =>
    matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    sync();
    window.addEventListener("resize", sync);

    let startX = 0;
    let startLeft = 0;
    let lastX = 0;
    let lastTime = 0;
    let speed = 0;
    let held = false;
    let dragged = false;

    const down = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      held = true;
      dragged = false;
      startX = lastX = event.clientX;
      lastTime = event.timeStamp;
      startLeft = track.scrollLeft;
      speed = 0;
    };

    const move = (event: PointerEvent) => {
      if (!held) return;
      const dx = event.clientX - startX;
      // A few pixels of wobble is still a click.
      if (!dragged && Math.abs(dx) < 5) return;
      if (!dragged) {
        dragged = true;
        track.setPointerCapture(event.pointerId);
        track.dataset.dragging = "";
      }
      track.scrollLeft = startLeft - dx;
      const dt = event.timeStamp - lastTime;
      if (dt > 0) speed = (event.clientX - lastX) / dt;
      lastX = event.clientX;
      lastTime = event.timeStamp;
    };

    const up = () => {
      if (!held) return;
      held = false;
      if (!dragged) return;
      const release = () => delete track.dataset.dragging;
      const card = step();
      const max = track.scrollWidth - track.clientWidth;
      // A little momentum: 300ms of the release speed, never more than a card.
      const carry = Math.min(card, Math.max(-card, -speed * 300));
      const landing = Math.round((track.scrollLeft + carry) / card) * card;
      const target = Math.min(max, Math.max(0, landing));
      // Snapping stays off until the glide has landed on a card, or the
      // browser would snap first and glide from there. A target the row is
      // already at never fires scrollend, so that case releases at once.
      if (Math.abs(target - track.scrollLeft) < 1) return release();
      if ("onscrollend" in track) {
        track.addEventListener("scrollend", release, { once: true });
      } else {
        setTimeout(release, 600);
      }
      track.scrollTo({ left: target, behavior: behavior() });
    };

    // The click that ends a drag is not a request to open the card under it.
    const click = (event: MouseEvent) => {
      if (!dragged) return;
      dragged = false;
      event.preventDefault();
      event.stopPropagation();
    };

    track.addEventListener("pointerdown", down);
    track.addEventListener("pointermove", move);
    track.addEventListener("pointerup", up);
    track.addEventListener("pointercancel", up);
    track.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("resize", sync);
      track.removeEventListener("pointerdown", down);
      track.removeEventListener("pointermove", move);
      track.removeEventListener("pointerup", up);
      track.removeEventListener("pointercancel", up);
      track.removeEventListener("click", click, true);
    };
  }, []);

  const scrollByCard = (direction: 1 | -1) =>
    trackRef.current?.scrollBy({
      left: direction * step(),
      behavior: behavior(),
    });

  const open = (index: number, opener: HTMLButtonElement) => {
    openerRef.current = opener;
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
            <RoundButton
              label="Previous pages"
              disabled={atStart}
              onClick={() => scrollByCard(-1)}
              path="M15 18l-6-6 6-6"
            />
            <RoundButton
              label="Next pages"
              disabled={atEnd}
              onClick={() => scrollByCard(1)}
              path="M9 18l6-6-6-6"
            />
          </div>
        </div>

        <ul
          ref={trackRef}
          data-reveal=""
          data-stagger=""
          onScroll={sync}
          className="brochure-track mt-5 flex snap-x snap-mandatory gap-4 overflow-x-auto pt-2 pb-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {BROCHURE_PAGES.map((card, index) => (
            <li
              key={card.src}
              className="w-[260px] shrink-0 snap-start sm:w-[300px]"
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
                    sizes="(min-width: 640px) 300px, 260px"
                    className="h-auto w-full"
                  />
                </span>
                <span className="mt-3 block px-1 text-base font-semibold text-navy">
                  {card.title}
                </span>
                <span className="tabular block px-1 text-sm text-neutral-500">
                  Page {index + 1} of {BROCHURE_PAGES.length}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div
          aria-hidden
          className="h-0.5 overflow-hidden rounded-full bg-navy/10"
        >
          <div
            ref={barRef}
            className="brochure-progress h-full origin-left bg-campfire"
          />
        </div>

        <p className="mt-3 text-sm text-neutral-500">
          Five pages from the printed brochure. Select one to read what it
          covers.
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
        onClose={() => openerRef.current?.focus()}
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
