import Link from "next/link";

import { YouTubeEmbed } from "@/components/media/youtube-embed";
import { LAUNCH_VIDEO, VISION_SUMMARY } from "@/content/project";

/**
 * What is being built, led by the launch video.
 *
 * No band: it sits on the page itself, between two navy sections, so the
 * video is the entry and the words follow it. The copy takes about 62 per cent
 * of the width and leaves the rest empty on purpose, with a heading a step
 * below the other sections, because the video has already opened the section.
 * The video stays click to load.
 */
export function VisionSection() {
  return (
    <section id="vision" className="page-gutter section">
      <div className="container-marketing">
        <div data-reveal="">
          <YouTubeEmbed
            id={LAUNCH_VIDEO.id}
            title={LAUNCH_VIDEO.title}
            sizes="(min-width: 1280px) 1200px, 100vw"
          />
        </div>

        <div data-reveal="" className="mt-8 md:w-[62%] lg:mt-10">
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
