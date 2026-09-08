"use client";

import { useId, useState } from "react";

import type { FaqCategory } from "@/content/project";
import { cn } from "@/lib/utils";

/**
 * The FAQ, grouped into categories.
 *
 * Hand rolled: this sits in the public bundle and the whole behaviour is two
 * pieces of state. The tab strip scrolls sideways on a phone rather than
 * wrapping, so the four categories stay on one line and the active one keeps
 * its underline.
 *
 * Answers open on a max-height transition rather than by mounting and
 * unmounting, which keeps the movement in CSS. A closed answer is marked
 * aria-hidden so a screen reader does not read the whole page of answers at
 * once; the answers contain no links, so nothing focusable is hidden.
 */
export function FaqTabs({ categories }: { categories: readonly FaqCategory[] }) {
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState<number | null>(0);
  const baseId = useId();

  const category = categories[active];
  const tabId = (i: number) => `${baseId}-tab-${i}`;
  const panelId = (i: number) => `${baseId}-panel-${i}`;

  function selectCategory(index: number) {
    setActive(index);
    // Each category opens on its first answer, so the panel is never a wall of
    // closed rows after a switch.
    setOpen(0);
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Question categories"
        className="-mx-4 flex gap-6 overflow-x-auto border-b border-neutral-200 px-4 [scrollbar-width:none] sm:mx-0 sm:px-0"
      >
        {categories.map((c, i) => {
          const selected = i === active;
          return (
            <button
              key={c.id}
              type="button"
              role="tab"
              id={tabId(i)}
              aria-selected={selected}
              aria-controls={panelId(i)}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectCategory(i)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
                  return;
                }
                event.preventDefault();
                const delta = event.key === "ArrowRight" ? 1 : -1;
                const next =
                  (active + delta + categories.length) % categories.length;
                selectCategory(next);
                document.getElementById(tabId(next))?.focus();
              }}
              className={cn(
                "-mb-px shrink-0 cursor-pointer border-b-2 px-1 pb-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none sm:text-base",
                selected
                  ? "border-campfire text-navy"
                  : "border-transparent text-neutral-500 hover:text-neutral-700",
              )}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <div
        key={category.id}
        role="tabpanel"
        id={panelId(active)}
        aria-labelledby={tabId(active)}
        className="faq-fade mt-2 divide-y divide-neutral-200"
      >
        {category.items.map((item, index) => {
          const isOpen = open === index;
          const questionId = `${baseId}-q${active}-${index}`;
          const answerId = `${baseId}-a${active}-${index}`;

          return (
            <div key={item.question}>
              <h3>
                <button
                  type="button"
                  id={questionId}
                  aria-expanded={isOpen}
                  aria-controls={answerId}
                  onClick={() => setOpen(isOpen ? null : index)}
                  className="flex w-full cursor-pointer items-start justify-between gap-4 py-5 text-left focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-inset focus-visible:outline-none"
                >
                  <span className="text-base font-medium text-navy sm:text-lg">
                    {item.question}
                  </span>

                  <span
                    aria-hidden
                    className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-navy/5 text-navy"
                  >
                    {/* A plus turned through 45 degrees is a cross, so one
                        shape covers both states. */}
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      className={cn(
                        "size-3.5 transition-transform duration-200",
                        isOpen && "rotate-45",
                      )}
                    >
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </span>
                </button>
              </h3>

              <div
                id={answerId}
                aria-hidden={!isOpen}
                className={cn(
                  "overflow-hidden transition-[max-height] duration-300 ease-out",
                  isOpen ? "max-h-96" : "max-h-0",
                )}
              >
                <p className="max-w-3xl pb-5 text-base leading-relaxed text-neutral-700">
                  {item.answer}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
