import type { Metadata } from "next";

import { PledgeCta } from "@/components/site/pledge-cta";
import { SOCIAL_LINKS, UPDATES_PLACEHOLDER } from "@/content/project";
import { pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata({
  title: "Project updates",
  description:
    "Updates on funding, design, and construction progress for the Crystal Fountain Development Project.",
  path: "/updates",
});

export default function UpdatesPage() {
  return (
    <>
      <section className="bg-navy px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto w-full max-w-5xl">
          <h1 className="text-3xl font-semibold tracking-tight text-balance text-white sm:text-4xl">
            Project updates
          </h1>
        </div>
      </section>

      <section className="bg-white px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto w-full max-w-3xl">
          <p className="text-base leading-relaxed text-neutral-700">
            {UPDATES_PLACEHOLDER}
          </p>

          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-base">
            {SOCIAL_LINKS.map((social) => (
              <li key={social.label}>
                <a
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded text-denim underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
                >
                  {social.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <PledgeCta heading="Record your pledge" />
    </>
  );
}
