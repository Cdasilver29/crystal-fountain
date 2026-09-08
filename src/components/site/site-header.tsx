import Link from "next/link";

import { CAMPAIGN } from "@/content/campaign";

/**
 * Top navigation. Two links, so no hamburger: they stay visible at every width
 * and simply tighten up on a narrow phone.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-navy">
      <nav
        aria-label="Main"
        className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-3 sm:px-6"
      >
        <Link
          href="/"
          className="mr-auto text-sm font-semibold tracking-tight text-white sm:text-base"
        >
          {CAMPAIGN.shortName}
        </Link>

        <Link
          href="/#about"
          className="rounded px-2 py-1.5 text-sm text-white/80 underline-offset-4 hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
        >
          About
        </Link>

        <Link
          href="/pledge"
          className="rounded-lg bg-campfire px-3 py-1.5 text-sm font-medium text-white hover:bg-campfire/90 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
        >
          Make a pledge
        </Link>
      </nav>
    </header>
  );
}
