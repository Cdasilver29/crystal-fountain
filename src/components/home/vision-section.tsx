import Link from "next/link";

import { YouTubeEmbed } from "@/components/media/youtube-embed";
import { LAUNCH_VIDEO, VISION_SUMMARY } from "@/content/project";

/**
 * What is being built, with the launch video beside it.
 *
 * Copy first in the source order, so a phone reads the explanation before it
 * reaches the video, and the video is click to load either way.
 */
export function VisionSection() {
  return (
    <section
      id="vision"
      className="scroll-mt-16 bg-[#f8f7f5] px-4 py-16 sm:px-6 sm:py-20"
    >
      <div className="mx-auto w-full max-w-5xl">
        <h2 className="text-2xl font-semibold tracking-tight text-balance text-navy sm:text-4xl">
          More than a building project
        </h2>

        <div className="mt-8 grid gap-8 md:grid-cols-[3fr_2fr] md:items-start md:gap-12">
          <div>
            <p className="text-base leading-loose text-neutral-700 sm:text-lg">
              {VISION_SUMMARY}
            </p>

            <Link
              href="/vision"
              className="mt-6 inline-flex rounded font-medium text-campfire underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
            >
              Learn more about the vision &rarr;
            </Link>
          </div>

          <YouTubeEmbed id={LAUNCH_VIDEO.id} title={LAUNCH_VIDEO.title} />
        </div>
      </div>
    </section>
  );
}
