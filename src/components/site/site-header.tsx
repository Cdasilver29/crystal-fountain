"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { MobileNav } from "@/components/site/mobile-nav";
import { SdaSymbol } from "@/components/site/sda-symbol";
import { CONTACT } from "@/content/campaign";
import { CD_FUND } from "@/content/cd-fund";
import { NAV_LINKS } from "@/content/project";

/**
 * Top navigation.
 *
 * Fixed, so it floats over the hero rather than pushing it down. Full height at
 * the top of the page; once the page has scrolled about 40px it compacts to
 * 64px, goes solid and takes a shadow, and it restores at the top. A sentinel
 * 40px tall at the top of the document tells one IntersectionObserver which of
 * the two it is. No scroll listener: the observer fires once each way rather
 * than on every frame of a scroll.
 *
 * The compacting is done with transforms, never with the header's own height.
 * The box stays 80px tall and the page below never moves; what slides up is
 * the background layer and the contents, and the logo scales to 80 per cent.
 * The header itself cannot take the transform, because the phone drawer inside
 * it is fixed to the viewport and a transformed ancestor would pin it to the
 * header instead. The 16px strip the compact header no longer covers lets
 * clicks through, since only the header's contents take pointer events.
 *
 * On the home page the header is clear over the hero until it compacts. Other
 * pages have no hero and it is solid from the start.
 *
 * The z-50 is load bearing. Being fixed and z-indexed, this header is a
 * stacking context, so the phone drawer inside it can never climb higher than
 * the header itself however large its own z-index is. Sections that layer an
 * image under their content sit at z-10, so the header has to outrank them or
 * the menu opens underneath the page.
 */
export function SiteHeader() {
  const [compact, setCompact] = useState(false);
  const [overHero, setOverHero] = useState(false);
  const pathname = usePathname();
  const linksRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const sentinel = document.getElementById("header-sentinel");
    const hasHero = document.getElementById("hero") !== null;
    if (!sentinel) return;

    const observer = new IntersectionObserver(([entry]) => {
      setCompact(!entry.isIntersecting);
      setOverHero(hasHero && entry.isIntersecting);
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [pathname]);

  /*
   * One indicator bar for the nav links. It rests under the current page's
   * link, glides to whichever link is hovered or focused, and goes back when
   * the pointer or focus leaves the links. Moved by writing its style directly,
   * since a re-render per hover would buy nothing.
   */
  useEffect(() => {
    const links = linksRef.current;
    const bar = barRef.current;
    if (!links || !bar) return;

    const moveTo = (link: HTMLElement | null) => {
      if (!link) {
        bar.style.opacity = "0";
        return;
      }
      // Appearing from nothing, it shows up in place rather than gliding in
      // from wherever it was last hidden.
      const hidden = bar.style.opacity !== "1";
      if (hidden) bar.style.transition = "none";
      bar.style.transform = `translateX(${link.offsetLeft + 10}px)`;
      bar.style.width = `${link.offsetWidth - 20}px`;
      bar.style.opacity = "1";
      if (hidden) {
        void bar.offsetWidth;
        bar.style.transition = "";
      }
    };

    const toTarget = (event: Event) => {
      const link = (event.target as Element).closest<HTMLElement>(".nav-link");
      if (link) moveTo(link);
    };
    const toCurrent = () =>
      moveTo(links.querySelector<HTMLElement>('[aria-current="page"]'));

    toCurrent();
    void document.fonts?.ready.then(toCurrent);
    links.addEventListener("pointerover", toTarget);
    links.addEventListener("focusin", toTarget);
    links.addEventListener("pointerleave", toCurrent);
    links.addEventListener("focusout", toCurrent);
    window.addEventListener("resize", toCurrent);
    return () => {
      links.removeEventListener("pointerover", toTarget);
      links.removeEventListener("focusin", toTarget);
      links.removeEventListener("pointerleave", toCurrent);
      links.removeEventListener("focusout", toCurrent);
      window.removeEventListener("resize", toCurrent);
    };
  }, [pathname]);

  return (
    <>
      <div
        id="header-sentinel"
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 h-10 w-px"
      />

      <header
        data-compact={compact ? "" : undefined}
        data-solid={overHero ? undefined : ""}
        className="site-header page-gutter fixed inset-x-0 top-0 z-50 h-20"
      >
        <div
          aria-hidden
          className={`site-header-bg absolute inset-0 -z-10 border-b ${
            overHero ? "border-transparent" : "border-white/10 bg-navy"
          }`}
        />

        <nav
          aria-label="Main"
          className="container-marketing flex h-full items-center gap-3"
        >
          <a
            href={CONTACT.siteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="header-logo mr-auto flex items-center gap-2.5 rounded text-white focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
          >
            <SdaSymbol className="h-10 w-auto shrink-0" />
            {/*
              Three lines set identically, so the block reads as one lockup
              rather than a label with a headline under it.
            */}
            <span className="flex flex-col text-[0.5rem] leading-[1.4] font-medium tracking-[0.12em] text-white uppercase sm:text-[0.58rem]">
              <span>Seventh-day</span>
              <span>Adventist Church</span>
              <span>Newlife Nairobi</span>
            </span>
          </a>

          <div className="header-shift hidden items-center gap-1 sm:flex">
            <div ref={linksRef} className="relative flex items-center gap-1">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={pathname === link.href ? "page" : undefined}
                  className="nav-link rounded px-2.5 py-1.5 text-sm text-white/80 hover:text-white aria-[current=page]:text-white focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
                >
                  {link.label}
                </Link>
              ))}

              {/*
                The fund policy, last of the nav links rather than an entry in
                NAV_LINKS, because that list is also the phone drawer, where
                this link is set apart at the foot of the menu rather than
                listed in among the campaign pages.
              */}
              <Link
                href={CD_FUND.href}
                aria-current={pathname === CD_FUND.href ? "page" : undefined}
                className="nav-link rounded px-2.5 py-1.5 text-sm text-white/80 hover:text-white aria-[current=page]:text-white focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
              >
                {CD_FUND.label}
              </Link>

              <span
                ref={barRef}
                aria-hidden
                className="nav-indicator pointer-events-none absolute bottom-1 left-0 h-0.5 rounded-full bg-campfire opacity-0"
              />
            </div>

            {/*
              Two calls to action, weighted the same. Somebody who has already
              pledged is here to pay, and making them hunt for that in a footer
              while a bright orange button asks them to pledge again is how a
              campaign ends up with promises it never collects. Campfire for
              the promise, denim for the payment, so the two are told apart by
              colour rather than by size.
            */}
            <Link
              href="/redeem"
              className="btn-primary ml-1 bg-denim px-3 py-1.5 text-sm font-medium text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-navy focus-visible:outline-none"
            >
              Redeem your pledge
            </Link>

            <Link
              href="/pledge"
              className="btn-primary cta-sweep bg-campfire px-3 py-1.5 text-sm font-medium text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-navy focus-visible:outline-none"
            >
              Make a pledge
            </Link>
          </div>

          <MobileNav />
        </nav>
      </header>
    </>
  );
}
