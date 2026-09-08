import Link from "next/link";

import { CAMPAIGN, CONTACT } from "@/content/campaign";

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-navy px-4 py-10 sm:px-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 text-sm text-white/70">
        <p>
          &copy; 2026 {CONTACT.churchName}. {CAMPAIGN.name}.
        </p>

        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
          <Link
            href="/privacy"
            className="underline-offset-4 hover:text-white hover:underline"
          >
            Privacy
          </Link>
          <a
            href={CONTACT.siteUrl}
            className="underline-offset-4 hover:text-white hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {CONTACT.siteLabel}
          </a>
        </nav>

        <p className="text-white/50">{CAMPAIGN.hashtags.join(" ")}</p>
      </div>
    </footer>
  );
}
