import Link from "next/link";

import { CAMPAIGN, CONTACT } from "@/content/campaign";
import { NAV_LINKS, SOCIAL_LINKS } from "@/content/project";

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-navy px-4 py-10 sm:px-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 text-sm text-white/70">
        <p>
          &copy; 2026 {CONTACT.churchName}. {CAMPAIGN.name}.
        </p>

        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded underline-offset-4 hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/privacy"
            className="rounded underline-offset-4 hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
          >
            Privacy
          </Link>
          <a
            href={CONTACT.siteUrl}
            className="rounded underline-offset-4 hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
            target="_blank"
            rel="noopener noreferrer"
          >
            {CONTACT.siteLabel}
          </a>
        </nav>

        <nav aria-label="Social" className="flex flex-wrap gap-x-6 gap-y-2">
          {SOCIAL_LINKS.map((social) => (
            <a
              key={social.label}
              href={social.href}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded underline-offset-4 hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
            >
              {social.label}
            </a>
          ))}
        </nav>

        <p className="text-white/50">{CAMPAIGN.hashtags.join(" ")}</p>
      </div>
    </footer>
  );
}
