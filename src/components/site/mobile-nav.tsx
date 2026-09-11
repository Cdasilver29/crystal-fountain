"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { NAV_LINKS } from "@/content/project";

/**
 * The phone navigation drawer.
 *
 * Hand rolled rather than taken from a dialog library. This component sits in
 * the layout, so whatever it imports is loaded on every public page including
 * /pledge, and the whole behaviour here is one boolean, an Escape key and a
 * scroll lock.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Close on navigation, so tapping a link does not leave the drawer sitting
  // open over the page it just went to.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    // Stop the page behind the drawer scrolling under a thumb drag.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <div className="sm:hidden">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-white focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
          className="size-6"
        >
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={() => setOpen(false)}
            className="absolute inset-0 size-full cursor-default bg-navy/60"
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="drawer-in absolute inset-y-0 right-0 flex w-[min(20rem,85vw)] flex-col gap-6 overflow-y-auto border-l border-white/10 bg-navy px-5 py-4 shadow-2xl"
          >
            <div className="flex items-center justify-end">
              <button
                ref={closeRef}
                type="button"
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                aria-label="Close menu"
                className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-white focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden
                  className="size-5"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            {/*
              Both calls to action, the same size, told apart by colour. On a
              phone this drawer is the whole navigation, so leaving the paying
              route out of it would leave it out altogether for most of the
              congregation.
            */}
            <div className="flex flex-col gap-2.5">
              <Link
                href="/pledge"
                className="flex h-12 items-center justify-center rounded-xl bg-campfire text-base font-semibold text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-navy focus-visible:outline-none"
              >
                Make a pledge
              </Link>

              <Link
                href="/redeem"
                className="flex h-12 items-center justify-center rounded-xl bg-denim text-base font-semibold text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-navy focus-visible:outline-none"
              >
                Redeem your pledge
              </Link>
            </div>

            <nav aria-label="Menu" className="flex flex-col">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={pathname === link.href ? "page" : undefined}
                  className="border-b border-white/10 py-3.5 text-lg text-white/90 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none aria-[current=page]:text-campfire"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}
