import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/metadata";

/**
 * The sitemap, for search engines.
 *
 * Only the nine public pages are listed. Everything else on this site is
 * deliberately absent rather than merely unlinked:
 *
 * - /p/<token> and /pledge/confirmed/<token> are somebody's pledge record,
 *   reachable only by a 22 character token. Listing one would publish the
 *   token, which is the only thing standing between a stranger and that
 *   record. Both pages already carry noindex; this is the second lock.
 * - /admin/* is the treasurer's portal.
 * - /api/* is not a page.
 *
 * robots.ts disallows all three as well. A sitemap is a suggestion of what to
 * crawl, not a fence, so the fence is stated separately.
 *
 * Every URL is built from SITE_URL, the same origin the canonical tags and the
 * Open Graph cards use, so a preview deployment advertises itself rather than
 * production.
 */

type Entry = {
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
};

/*
 * Change frequency follows what actually changes.
 *
 * The home page and the progress page carry live totals read from the database
 * on every request, so both move whenever a pledge lands: daily. The content
 * pages are typed data in the repo and change when somebody deploys: weekly.
 * The privacy notice changes when the practice behind it changes, which is
 * rare: monthly.
 *
 * Priority is relative within this site only. It says nothing to a search
 * engine about how this site ranks against any other, only which of these nine
 * pages matters most when a crawler has to choose. The pledge form is the
 * point of the whole site, so it sits just under the home page.
 */
const PAGES: readonly Entry[] = [
  { path: "/", changeFrequency: "daily", priority: 1.0 },
  { path: "/pledge", changeFrequency: "weekly", priority: 0.9 },
  { path: "/vision", changeFrequency: "weekly", priority: 0.8 },
  { path: "/progress", changeFrequency: "daily", priority: 0.8 },
  { path: "/faq", changeFrequency: "weekly", priority: 0.7 },
  { path: "/updates", changeFrequency: "weekly", priority: 0.7 },
  { path: "/cd-fund", changeFrequency: "weekly", priority: 0.7 },
  { path: "/redeem", changeFrequency: "weekly", priority: 0.7 },
  { path: "/privacy", changeFrequency: "monthly", priority: 0.7 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  /*
   * One timestamp for the whole file, taken once when it is generated.
   *
   * Calling new Date() per entry would stamp nine times and invite a crawler
   * to read the spread as nine separate edits. The build is the edit.
   */
  const lastModified = new Date();

  /*
   * SITE_URL has no trailing slash and every path here has a leading one, so
   * the home page comes out as https://host/ rather than https://host. That is
   * deliberate: it is character for character the canonical URL pageMetadata
   * writes into the head, and a sitemap that disagrees with a canonical tag
   * about a trailing slash is two URLs to a crawler.
   */
  return PAGES.map(({ path, changeFrequency, priority }) => ({
    url: `${SITE_URL}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}
