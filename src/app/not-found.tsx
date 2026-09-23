import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import {
  STATUS_INLINE,
  STATUS_PRIMARY,
  STATUS_SECONDARY,
  StatusPage,
} from "@/components/site/status-page";
import { CONTACT } from "@/content/campaign";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

/**
 * The 404, for an unknown URL and for every notFound() in the app.
 *
 * It lives at the root rather than under (site) because only a root not-found
 * catches URLs that match no route at all. The root layout has no site chrome,
 * so the header and footer are added here the same way the (site) layout adds
 * them. The most common way to land here is a pledge link with a mistyped or
 * truncated token, which is what the footnote is for.
 */
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <div aria-hidden className="h-16" />
      <div className="flex flex-1 flex-col">
        <StatusPage
          title="Page not found"
          lead="That page does not exist, or the link may be out of date."
          actions={
            <>
              <Link href="/" className={STATUS_SECONDARY}>
                Home
              </Link>
              <Link href="/pledge" className={STATUS_PRIMARY}>
                Make a pledge
              </Link>
              <Link href="/redeem" className={STATUS_SECONDARY}>
                Check my pledge
              </Link>
            </>
          }
          footnote={
            <>
              If you were following a pledge link, check the reference and try
              again at{" "}
              <Link href="/redeem" className={STATUS_INLINE}>
                /redeem
              </Link>
              , or contact the development office on{" "}
              <a href={CONTACT.phoneHref} className={STATUS_INLINE}>
                {CONTACT.phoneDisplay}
              </a>
              .
            </>
          }
        />
      </div>
      <SiteFooter />
    </>
  );
}
