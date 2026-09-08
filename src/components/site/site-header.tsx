import Link from "next/link";

import { MobileNav } from "@/components/site/mobile-nav";
import { CAMPAIGN } from "@/content/campaign";
import { NAV_LINKS } from "@/content/project";

/**
 * Top navigation.
 *
 * Links sit inline from the small breakpoint up. Below that they move into the
 * drawer in MobileNav, which is the only client component in the header.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-navy">
      <nav
        aria-label="Main"
        className="mx-auto flex w-full max-w-5xl items-center gap-1 px-4 py-3 sm:gap-2 sm:px-6"
      >
        <Link
          href="/"
          className="mr-auto rounded text-sm font-semibold tracking-tight text-white focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none sm:text-base"
        >
          {CAMPAIGN.shortName}
        </Link>

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
