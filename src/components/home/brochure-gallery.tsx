"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  BROCHURE_HEIGHT,
  BROCHURE_PAGES,
  BROCHURE_WIDTH,
} from "@/content/project";

/**
 * The printed trifold, as a snapping strip with a lightbox.
 *
 * The source scans are 1688x2000 and roughly 300kB each, so nothing here links
 * a raw file: every image goes through next/image with an explicit sizes hint,
 * and a phone is served a card sized version rather than the full scan.
 *
 * Arrows appear from the medium breakpoint up. On a phone the snap points do
 * the work and there is nothing extra to tap.
 */
export function BrochureGallery() {
  const stripRef = useRef<HTMLUListElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [openAt, setOpenAt] = useState<number | null>(null);

  const syncArrows = useCallback(() => {
    const strip = stripRef.current;
    if (!strip) return;
    setAtStart(strip.scrollLeft <= 4);
    setAtEnd(strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 4);
  }, []);

  useEffect(() => {
    syncArrows();
    window.addEventListener("resize", syncArrows);
    return () => window.removeEventListener("resize", syncArrows);
  }, [syncArrows]);

  const scrollByCard = (direction: 1 | -1) => {
    const strip = stripRef.current;
    if (!strip) return;
    const card = strip.querySelector("li");
    const step = card ? card.getBoundingClientRect().width + 16 : 300;
    strip.scrollBy({ left: direction * step, behavior: "smooth" });
  };

  return (
    <section className="bg-[#f8f7f5] px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto w-full max-w-5xl">
        <h2 className="text-2xl font-semibold tracking-tight text-navy sm:text-4xl">
          The development plan
        </h2>

        <div className="relative mt-8">
          <ul
            ref={stripRef}
            onScroll={syncArrows}
            className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4 [scrollbar-width:thin]"
          >
            {BROCHURE_PAGES.map((page, index) => (
              <li key={page.src} className="w-[280px] shrink-0 snap-start md:w-[360px]">
                <button
                  type="button"
                  onClick={() => setOpenAt(index)}
                  aria-label={`Open ${page.alt} larger`}
                  className="block w-full cursor-zoom-in overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  <Image
                    src={page.src}
                    alt={page.alt}
                    width={BROCHURE_WIDTH}
                    height={BROCHURE_HEIGHT}
                    loading="lazy"
                    sizes="(max-width: 768px) 280px, 360px"
                    className="h-auto w-full"
                  />
                </button>
              </li>
            ))}
          </ul>

          <Arrow side="left" hidden={atStart} onClick={() => scrollByCard(-1)} />
          <Arrow side="right" hidden={atEnd} onClick={() => scrollByCard(1)} />
        </div>

        <p className="mt-2 text-sm text-neutral-500">
          Five pages from the printed brochure. Select one to view it larger.
        </p>
      </div>

      {openAt !== null && (
        <Lightbox
          index={openAt}
          onClose={() => setOpenAt(null)}
          onNavigate={setOpenAt}
        />
      )}
    </section>
  );
}

function Arrow({
  side,
  hidden,
  onClick,
}: {
  side: "left" | "right";
  hidden: boolean;
  onClick: () => void;
}) {
  if (hidden) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Scroll left" : "Scroll right"}
      className={`absolute top-1/2 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white text-navy shadow-md transition-colors hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none md:flex ${
        side === "left" ? "-left-4" : "-right-4"
      }`}
    >
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
        <path d={side === "left" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"} />
      </svg>
    </button>
  );
}

/**
 * The lightbox.
 *
 * A fixed overlay, a contained image and three listeners. Focus is held inside
 * by keeping it on the panel and cycling Tab between the controls, and the
 * page behind cannot scroll while it is open.
 */
function Lightbox({
  index,
  onClose,
  onNavigate,
}: {
  index: number;
  onClose: () => void;
  onNavigate: (next: number) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const page = BROCHURE_PAGES[index];
  const last = BROCHURE_PAGES.length - 1;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") onNavigate(index === last ? 0 : index + 1);
      if (event.key === "ArrowLeft") onNavigate(index === 0 ? last : index - 1);
      if (event.key === "Tab") {
        // Keep focus inside: cycle through the panel's own controls.
        const focusable = panelRef.current?.querySelectorAll<HTMLElement>("button");
        if (!focusable || focusable.length === 0) return;
        const list = [...focusable];
        const current = list.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        const next = event.shiftKey
          ? (current <= 0 ? list.length : current) - 1
          : (current + 1) % list.length;
        list[next]?.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [index, last, onClose, onNavigate]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={page.alt}
      ref={panelRef}
      tabIndex={-1}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 focus:outline-none"
    >
      <Image
        src={page.src}
        alt={page.alt}
        width={BROCHURE_WIDTH}
        height={BROCHURE_HEIGHT}
        sizes="90vw"
        onClick={(event) => event.stopPropagation()}
        className="max-h-[90vh] w-auto max-w-full object-contain"
      />

      <LightboxButton label="Close" onClick={onClose} className="top-4 right-4">
        <path d="M6 6l12 12M18 6L6 18" />
      </LightboxButton>

      <LightboxButton
        label="Previous page"
        onClick={() => onNavigate(index === 0 ? last : index - 1)}
        className="top-1/2 left-4 -translate-y-1/2"
      >
        <path d="M15 18l-6-6 6-6" />
      </LightboxButton>

      <LightboxButton
        label="Next page"
        onClick={() => onNavigate(index === last ? 0 : index + 1)}
        className="top-1/2 right-4 -translate-y-1/2"
      >
        <path d="M9 18l6-6-6-6" />
      </LightboxButton>

      <p className="tabular absolute bottom-5 left-1/2 -translate-x-1/2 text-sm text-white/70">
        {index + 1} of {BROCHURE_PAGES.length}
      </p>
    </div>
  );
}

function LightboxButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`absolute flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none ${className}`}
    >
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
        {children}
      </svg>
    </button>
  );
}
