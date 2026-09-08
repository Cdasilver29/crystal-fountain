import Link from "next/link";

import { CAMPAIGN, CONTACT } from "@/content/campaign";
import { NAV_LINKS, SOCIAL_LINKS } from "@/content/project";

/**
 * Icons for the church's accounts, hand drawn as paths.
 *
 * lucide-react is installed but dropped its brand icons, and this is four
 * shapes, so they live here rather than pulling in an icon package for them.
 */
const SOCIAL_ICONS: Record<string, React.ReactNode> = {
  Facebook: (
    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
  ),
  Twitter: (
    <path d="M18.9 2H22l-7.2 8.3L23.3 22h-6.6l-5.2-6.8L5.5 22H2.4l7.7-8.9L1.1 2h6.8l4.7 6.2zm-1.2 18.1h1.8L7.4 3.8H5.5z" />
  ),
  Instagram: (
    <>
      <rect x="2" y="2" width="20" height="20" rx="5.5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.6" cy="6.4" r="1.2" />
    </>
  ),
  YouTube: (
    <>
      <path d="M22.9 7.6a2.8 2.8 0 0 0-2-2C19.2 5.2 12 5.2 12 5.2s-7.2 0-8.9.4a2.8 2.8 0 0 0-2 2A29 29 0 0 0 .7 12a29 29 0 0 0 .4 4.4 2.8 2.8 0 0 0 2 2c1.7.4 8.9.4 8.9.4s7.2 0 8.9-.4a2.8 2.8 0 0 0 2-2 29 29 0 0 0 .4-4.4 29 29 0 0 0-.4-4.4z" />
      <path d="M9.8 15.3V8.7l5.7 3.3z" />
    </>
  ),
};

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-navy px-4 py-10 sm:px-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 text-sm text-white/70">
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

        <nav aria-label="Social" className="flex flex-wrap gap-4">
          {SOCIAL_LINKS.map((social) => (
            <a
              key={social.label}
              href={social.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${CONTACT.churchName} on ${social.label}`}
              className="flex size-9 items-center justify-center rounded-full text-white/60 transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
            >
              <svg
                viewBox="0 0 24 24"
                fill={social.label === "Instagram" ? "none" : "currentColor"}
                stroke={social.label === "Instagram" ? "currentColor" : "none"}
                strokeWidth="1.8"
                aria-hidden
                className="size-5"
              >
                {SOCIAL_ICONS[social.label]}
              </svg>
            </a>
          ))}
        </nav>

        <p className="text-white/50">{CAMPAIGN.hashtags.join(" ")}</p>
      </div>
    </footer>
  );
}
