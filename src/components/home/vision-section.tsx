import Link from "next/link";

import { YouTubeEmbed } from "@/components/media/youtube-embed";
import { LAUNCH_VIDEO, VISION_SUMMARY } from "@/content/project";

/**
 * What is being built, led by the launch video.
 *
 * No band: it sits on the page itself, between two navy sections. From 1024px
 * up the video takes about 58 per cent of the width on the left and the copy
 * the rest, centred against it, so the whole section fits a laptop screen.
 * Below that they stack with the video first. The heading is a step below the
 * other sections, because the video has already opened the section. The video
 * stays click to load.
 */
export function VisionSection() {
  return (
    <section id="vision" className="page-gutter section">
      <div className="container-marketing lg:grid lg:grid-cols-[7fr_5fr] lg:items-center lg:gap-12">
        <div data-reveal="">
          {/* 7/12 of the 1080px container less the gap is 602px; between
              1024 and 1280 the container is the viewport less the gutter. */}
          <YouTubeEmbed
            id={LAUNCH_VIDEO.id}
            title={LAUNCH_VIDEO.title}
            sizes="(min-width: 1280px) 602px, (min-width: 1024px) 58vw, 100vw"
          />
        </div>

        <div data-reveal="" className="mt-8 lg:mt-0">
          <h2 className="text-xl font-semibold tracking-tight text-balance text-navy sm:text-2xl">
            More than a building project
          </h2>

          <p className="mt-3 text-base leading-loose text-neutral-700 sm:text-lg">
            {VISION_SUMMARY}
          </p>

          <Link
            href="/vision"
            className="mt-5 inline-flex rounded font-medium text-campfire underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
          >
            Learn more about the vision &rarr;
          </Link>
        </div>
      </div>
    </section>
  );
}
