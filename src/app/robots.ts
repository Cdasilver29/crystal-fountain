import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/metadata";

/**
 * robots.txt.
 *
 * Every crawler is welcome on the nine public pages. Three trees are closed:
 *
 * - /admin/ is the treasurer's portal. It is behind a session cookie already,
 *   so this does not protect it; it keeps the login screen and the shape of
 *   the portal out of search results.
 * - /api/ is not a page. Nothing there renders, and the export routes return
 *   contact details to an authenticated treasurer.
 * - /p/ is a pledge acknowledgement, addressed by a 22 character token. The
 *   pages carry noindex too, which is the rule that actually removes a URL a
 *   crawler has already seen; this one stops it being fetched at all.
 *
 * /pledge/confirmed/ is the same acknowledgement under a different path and is
 * closed here for the same reason. Note the ordering that makes this work:
 * /pledge itself is the form and must stay crawlable, and a robots.txt rule is
 * a prefix match, so the disallowed path is written with its trailing slash.
 * Without it this would close the pledge form, which is the one page the whole
 * site exists to get somebody to.
 *
 * The sitemap URL is built from SITE_URL rather than written out, so a preview
 * deployment points at its own sitemap instead of production's.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin/", "/api/", "/p/", "/pledge/confirmed/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
