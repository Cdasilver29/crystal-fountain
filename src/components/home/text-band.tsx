import { TEXT_BAND_WORDS } from "@/content/home";

/*
 * One copy of the words, run twice over so a copy is wider than a 1920px
 * window. The band slides left by exactly one copy and starts again, which is
 * the same picture, so the loop has no seam.
 */
const RUN = [...TEXT_BAND_WORDS, ...TEXT_BAND_WORDS];

/**
 * A slow band of words between the commitment section and the timeline.
 *
 * Texture rather than a headline: the serif large and faint on navy, drifting
 * left at about 35px a second on a CSS animation that moves only a transform.
 * It stops under the pointer, while the tab is hidden and, under reduced
 * motion, altogether. The first copy is read once by a screen reader and every
 * repeat is hidden from it.
 */
export function TextBand() {
  return (
    <div className="text-band overflow-x-clip border-y border-white/5 bg-navy py-5">
      <div className="text-band-track flex w-max">
        <Copy />
        <Copy hidden />
      </div>
    </div>
  );
}

function Copy({ hidden = false }: { hidden?: boolean }) {
  return (
    <p
      aria-hidden={hidden || undefined}
      className="font-display flex shrink-0 text-4xl leading-10 font-semibold whitespace-nowrap text-white/15"
    >
      {RUN.map((word, index) => (
        <span
          key={index}
          aria-hidden={index >= TEXT_BAND_WORDS.length || undefined}
        >
          {word}
          <span aria-hidden className="px-6">
            ·
          </span>
        </span>
      ))}
    </p>
  );
}
