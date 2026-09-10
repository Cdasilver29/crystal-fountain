import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";

// Imported for its side effect: validates the environment once, at build time,
// so a missing variable fails the build rather than a request.
import "@/env";

import { CAMPAIGN, OG } from "@/content/campaign";
import { SITE_URL } from "@/lib/metadata";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: CAMPAIGN.name,
    // Every page title carries the campaign name, since most arrivals come from
    // a WhatsApp link and the tab may be the only context a visitor has.
    template: `%s | ${CAMPAIGN.shortName}`,
  },
  description: OG.description,
  /*
   * The church's own mark, not the Next.js default.
   *
   * The SVG is what every current browser uses. The .ico is there for the
   * older ones and for anything that asks for /favicon.ico by convention
   * without reading the markup at all.
   *
   * All three are built from public/images/logo/sda-logo-white.svg, cropped to
   * the flame emblem and set on the campaign navy. The full logo could not be
   * used as it stands: it is a wide lockup whose wordmark is unreadable at
   * tab size, and it is filled pure white on a transparent ground, so it
   * disappears entirely on a light tab strip.
   */
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "32x32" },
    ],
    // iOS ignores an SVG here, so this one has to be a raster.
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    siteName: OG.title,
    title: OG.title,
    description: OG.description,
    url: SITE_URL,
    images: [{ url: OG.image, width: 1600, height: 1600, alt: OG.imageAlt }],
  },
  twitter: {
    card: "summary_large_image",
    title: OG.title,
    description: OG.description,
    images: [OG.image],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
