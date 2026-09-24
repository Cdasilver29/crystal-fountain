import type { ReactNode } from "react";

import { PointerMotion } from "@/components/motion/pointer-motion";
import { ScrollProgress } from "@/components/motion/scroll-progress";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";

/**
 * Chrome for the public pages only.
 *
 * Admin lives outside this group, so /admin/pledges does not get a public nav
 * with a "Make a pledge" button on it.
 *
 * The data-site wrapper is what the public motion rules in globals.css are
 * scoped to, since the admin shares the button classes. display: contents, so
 * it adds a selector and no box: the header, page and footer are still laid out
 * by the body exactly as before.
 */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div data-site="" className="contents">
      <ScrollProgress />
      <PointerMotion />
      <SiteHeader />
      {/* The header is fixed, so its height is reserved here once rather than
          in the top padding of every page. The hero cancels this out. */}
      <div aria-hidden className="h-16" />
      <div className="flex flex-1 flex-col">{children}</div>
      <SiteFooter />
    </div>
  );
}
