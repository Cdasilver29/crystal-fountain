import type { Metadata } from "next";

import { OG } from "@/content/campaign";
import { env } from "@/env";

/**
 * Open Graph and Twitter card metadata.
 *
 * Most arrivals will be from a WhatsApp group, so the card is the first thing
 * most of the congregation sees of this site. Every page gets an absolute
 * canonical URL and the campaign flyer as its image.
 */

export const SITE_URL = env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");

export function pageMetadata({
  title,
  description = OG.description,
  path,
  noIndex = false,
}: {
  /*
   * The page specific half of the tab title. The campaign name is appended by
   * the template in the root layout, so it is not written here.
   *
   * Two pages need a whole title of their own instead, because the campaign
   * name is not the right thing after the bar for them: the home page ends in
   * the church and its city, and the CD-Fund page belongs to the church rather
   * than to this campaign. Both pass an absolute title, which Next honours
   * over the template.
   */
  title: string | { absolute: string };
  description?: string;
  /** Path with a leading slash, for example "/pledge". */
  path: string;
  noIndex?: boolean;
}): Metadata {
  const url = `${SITE_URL}${path}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    robots: noIndex ? { index: false, follow: false } : undefined,
    openGraph: {
      type: "website",
      siteName: OG.title,
      title: OG.title,
      description,
      url,
      images: [
        {
          url: `${SITE_URL}${OG.image}`,
          width: 1600,
          height: 1600,
          alt: OG.imageAlt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: OG.title,
      description,
      images: [`${SITE_URL}${OG.image}`],
    },
  };
}
