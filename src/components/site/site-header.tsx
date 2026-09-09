"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { MobileNav } from "@/components/site/mobile-nav";
import { SdaSymbol } from "@/components/site/sda-symbol";
import { CONTACT } from "@/content/campaign";
import { NAV_LINKS } from "@/content/project";

/**
 * Top navigation.
 *
 * Fixed, so it floats over the hero rather than pushing it down. It carries no
 * background while the hero is behind it and takes on navy once the hero has
 * been scrolled past, which an IntersectionObserver on the hero reports. No
 * scroll listener: the observer fires twice for the whole page rather than on
 * every frame of a scroll.
 *
 * Pages other than the home page have no hero, so there is nothing to observe
 * and the header stays solid from the start.
 */
export function SiteHeader() {
  const [solid, setSolid] = useState(true);

  useEffect(() => {
    const hero = document.getElementById("hero");
    if (!hero) {
      setSolid(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setSolid(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(hero);
    return () => observer.disconnect();
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-10 h-16 border-b transition-colors duration-300 ${
        solid ? "border-white/10 bg-navy" : "border-transparent"
      }`}
    >
      <nav
        aria-label="Main"
        className="mx-auto flex h-full w-full max-w-5xl items-center gap-3 px-4 sm:px-6"
      >
        <a
          href={CONTACT.siteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mr-auto flex items-center gap-2.5 rounded text-white focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
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

        <div className="hidden items-center gap-1 sm:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded px-2.5 py-1.5 text-sm text-white/80 underline-offset-4 hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
            >
              {link.label}
            </Link>
          ))}

          <Link
            href="/pledge"
            className="ml-1 rounded-lg bg-campfire px-3 py-1.5 text-sm font-medium text-white hover:bg-campfire/90 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-navy focus-visible:outline-none"
          >
            Make a pledge
          </Link>
        </div>

        <MobileNav />
      </nav>
    </header>
  );
}
