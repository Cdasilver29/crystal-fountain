"use client";

import Image from "next/image";
import { useState } from "react";

/**
 * A click to load YouTube embed.
 *
 * The iframe is roughly half a megabyte of third party JavaScript, and most
 * visitors arrive on a phone over mobile data to read the numbers, not to watch
 * a video. So the page ships a poster image and a play button, and the iframe
 * is only created once someone actually asks for it.
 *
 * The player is the nocookie host, so YouTube sets nothing until playback.
 */

const POSTER_WIDTH = 1280;
const POSTER_HEIGHT = 720;

function posterUrl(id: string, quality: "maxresdefault" | "hqdefault"): string {
  return `https://i.ytimg.com/vi/${id}/${quality}.jpg`;
}

export function YouTubeEmbed({
  id,
  title,
  className,
}: {
  id: string;
  title: string;
  className?: string;
}) {
  const [playing, setPlaying] = useState(false);
  // maxresdefault only exists for videos uploaded at 720p or better, and a
  // missing one returns a grey placeholder rather than a 404. Fall back to
  // hqdefault, which every video has.
  const [quality, setQuality] = useState<"maxresdefault" | "hqdefault">(
    "maxresdefault",
  );

  return (
    <div
      className={`relative aspect-video w-full overflow-hidden rounded-2xl bg-navy ${className ?? ""}`}
    >
      {playing ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 size-full border-0"
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={`Play the video: ${title}`}
          className="group absolute inset-0 size-full cursor-pointer focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <Image
            src={posterUrl(id, quality)}
            onError={() => setQuality("hqdefault")}
            alt=""
            width={POSTER_WIDTH}
            height={POSTER_HEIGHT}
            sizes="(min-width: 768px) 640px, 100vw"
            className="size-full object-cover transition-opacity group-hover:opacity-90"
          />

          <span
            aria-hidden
            className="absolute inset-0 flex items-center justify-center"
          >
            <span className="flex size-16 items-center justify-center rounded-full bg-campfire shadow-lg transition-transform group-hover:scale-105 sm:size-20">
              <svg viewBox="0 0 24 24" fill="white" className="ml-1 size-7 sm:size-8">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </span>
        </button>
      )}
    </div>
  );
}
