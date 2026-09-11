import type { Metadata } from "next";
import Image from "next/image";

import { YouTubeEmbed } from "@/components/media/youtube-embed";
import { PledgeCta } from "@/components/site/pledge-cta";
import { RoadmapReveal } from "@/components/vision/roadmap-reveal";
import { Roadmap, RoadmapSteps } from "@/components/vision/roadmap";
import {
  ACCOUNTABILITY,
  BROCHURE_HEIGHT,
  BROCHURE_PAGES,
  BROCHURE_WIDTH,
  LAUNCH_VIDEO,
  SCRIPTURE_HAGGAI,
  VISION_SECTIONS,
  VISION_SUMMARY,
} from "@/content/project";
import { pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata({
  title: "The vision",
  description:
    "What the Crystal Fountain Development Project is building: the sanctuary, the facilities, the commercial tower, and the site.",
  path: "/vision",
});

export default function VisionPage() {
  return (
    <>
      <section className="bg-navy px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto w-full max-w-5xl">
          <h1 className="text-3xl font-semibold tracking-tight text-balance text-white sm:text-4xl">
            More than a building project
          </h1>

          <p className="mt-4 max-w-3xl text-base leading-relaxed text-white/80 sm:text-lg">
            {VISION_SUMMARY}
          </p>

          <div className="mt-9 max-w-3xl">
            <YouTubeEmbed id={LAUNCH_VIDEO.id} title={LAUNCH_VIDEO.title} />
          </div>

          <blockquote className="mt-9 max-w-2xl border-l-2 border-campfire pl-5">
            <p className="text-base leading-relaxed text-balance text-white/80 italic">
              {SCRIPTURE_HAGGAI.text}
            </p>
            <cite className="mt-2 block text-sm text-white/60 not-italic">
              {SCRIPTURE_HAGGAI.reference}
            </cite>
          </blockquote>
        </div>
      </section>

      {VISION_SECTIONS.map((section, index) => {
        const brochure =
          section.illustration === undefined
            ? undefined
            : BROCHURE_PAGES[section.illustration];

        return (
          <section
            key={section.id}
            id={section.id}
            className={`scroll-mt-16 px-4 py-12 sm:px-6 sm:py-16 ${
              index % 2 === 0 ? "bg-white" : "bg-neutral-50"
            }`}
          >
            <div className="mx-auto grid w-full max-w-5xl gap-8 md:grid-cols-[1.4fr_1fr] md:items-start md:gap-12">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-navy sm:text-3xl">
                  {section.heading}
                </h2>

                {section.paragraphs.map((paragraph) => (
                  <p
                    key={paragraph.slice(0, 40)}
                    className="mt-4 text-base leading-relaxed text-neutral-700"
                  >
                    {paragraph}
                  </p>
                ))}
              </div>

              {brochure && (
                <Image
                  src={brochure.src}
                  alt={brochure.alt}
                  width={BROCHURE_WIDTH}
                  height={BROCHURE_HEIGHT}
                  loading="lazy"
                  sizes="(min-width: 768px) 320px, 100vw"
                  className="h-auto w-full rounded-2xl border border-black/5 shadow-sm"
                />
              )}
            </div>
          </section>
        );
      })}

      {/*
        The steps are passed in already rendered, so RoadmapReveal is a wrapper
        around server output rather than the owner of it: the six cards and
        their icons never reach the browser as JavaScript, and all the client
        component contributes is the observer that starts the animation.
      */}
      <Roadmap
        reveal={
          <RoadmapReveal className="relative mt-10 sm:mt-12">
            <RoadmapSteps />
          </RoadmapReveal>
        }
      />

      <section className="bg-white px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto w-full max-w-5xl">
          <h2 className="text-2xl font-semibold tracking-tight text-navy sm:text-3xl">
            Oversight and accountability
          </h2>

          <p className="mt-4 max-w-3xl text-base leading-relaxed text-neutral-700">
            {ACCOUNTABILITY.oversight}
          </p>

          <p className="mt-4 max-w-3xl text-base leading-relaxed text-neutral-700">
            {ACCOUNTABILITY.updates}
          </p>
        </div>
      </section>

      <PledgeCta heading="Be part of it" />
    </>
  );
}
