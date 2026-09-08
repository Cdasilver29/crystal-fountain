import type { ReactNode } from "react";

import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";

/**
 * Chrome for the public pages only.
 *
 * Admin lives outside this group, so /admin/pledges does not get a public nav
 * with a "Make a pledge" button on it.
 */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      {/* The header is fixed, so its height is reserved here once rather than
          in the top padding of every page. The hero cancels this out. */}
      <div aria-hidden className="h-16" />
      <div className="flex flex-1 flex-col">{children}</div>
      <SiteFooter />
    </>
  );
}
