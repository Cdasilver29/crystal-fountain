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
