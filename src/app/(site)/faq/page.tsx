import type { Metadata } from "next";

import { FaqTabs } from "@/components/content/faq-tabs";
import { SectionBackground } from "@/components/media/section-background";
import { PledgeCta } from "@/components/site/pledge-cta";
import { FAQ_CATEGORIES } from "@/content/project";
import { pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata({
  title: "Frequently asked questions",
  description:
    "Answers about the Crystal Fountain Development Project: what is being built, what it costs, how it is funded, and what a pledge is.",
  path: "/faq",
});

export default function FaqPage() {
  return (
    <>
      <section className="relative overflow-hidden bg-navy px-4 py-12 sm:px-6 sm:py-16">
        <SectionBackground
          src="/images/gallery/FAQ.PNG"
          overlayClassName="bg-navy/[0.75]"
        />

        <div className="relative z-10 mx-auto w-full max-w-5xl">
          <h1 className="text-3xl font-semibold tracking-tight text-balance text-white sm:text-4xl">
            Frequently asked questions
          </h1>

          <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/80">
            What the project is, what it costs, and what happens when you record
            a pledge.
          </p>
        </div>
      </section>

      <section className="bg-white px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto w-full max-w-3xl">
          <FaqTabs categories={FAQ_CATEGORIES} />
        </div>
      </section>

      <PledgeCta heading="Ready to pledge?" />
    </>
  );
}
