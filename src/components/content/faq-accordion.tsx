"use client";

import { useId, useState } from "react";

import type { FaqItem } from "@/content/project";

/**
 * The FAQ accordion. One panel open at a time.
 *
 * Hand rolled rather than pulled from a component library, because this sits in
 * the public bundle and the whole behaviour is one piece of state. Closed
 * panels use the hidden attribute rather than a class, so a collapsed answer is
 * out of the accessibility tree and out of find in page.
 */
export function FaqAccordion({ items }: { items: readonly FaqItem[] }) {
  const [open, setOpen] = useState<number | null>(0);
  const baseId = useId();

  return (
    <div className="divide-y divide-neutral-200 border-y border-neutral-200">
      {items.map((item, index) => {
        const isOpen = open === index;
        const buttonId = `${baseId}-q${index}`;
        const panelId = `${baseId}-a${index}`;

        return (
          <div key={item.question}>
            <h3>
              <button
                type="button"
                id={buttonId}
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpen(isOpen ? null : index)}
                className="flex w-full cursor-pointer items-start justify-between gap-4 py-5 text-left focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-inset focus-visible:outline-none"
              >
                <span className="text-base font-medium text-navy sm:text-lg">
                  {item.question}
                </span>

                <span
                  aria-hidden
                  className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-navy/5 text-navy"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    className={`size-3.5 transition-transform duration-200 ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  >
                    <path d="M5 8.5 12 15.5 19 8.5" />
                  </svg>
                </span>
              </button>
            </h3>

            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              hidden={!isOpen}
            >
              <p className="max-w-3xl pb-5 text-base leading-relaxed text-neutral-700">
                {item.answer}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
