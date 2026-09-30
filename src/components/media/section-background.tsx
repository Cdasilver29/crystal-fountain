import { FadeImage } from "@/components/media/fade-image";

import { cn } from "@/lib/utils";

/**
 * A photographic backdrop for a full width section.
 *
 * The source files are a few hundred kB of JPEG, and nothing here links a raw
 * file: the image goes through next/image, which serves a WebP at the width the
 * viewport actually needs. It is laid out with fill inside a positioned,
 * clipped section, so it takes no space of its own and cannot shift the
 * content or push the page sideways on a narrow screen.
 *
 * It covers the band and crops whatever does not fit, which is what a backdrop
 * is: the picture is a texture behind a heading, not something a reader is
 * being asked to look at. Where the crop falls is still chosen per photograph:
 * position is an object-position, set so the part worth seeing survives a
 * short wide band on a laptop and a narrow one on a phone.
 *
 * The overlay is a separate layer above the image and below the content, so
 * the section keeps its own colour and the text on top stays readable whatever
 * the photograph is doing underneath. A backdrop is lazy unless it is the
 * first thing on its page: a page banner passes priority, so the picture is
 * requested with the document instead of after layout has found it.
 *
 * The caller is responsible for two things: the section must be relative and
 * overflow hidden, and the content must sit on a higher layer.
 */
export function SectionBackground({
  src,
  overlayClassName,
  position = "center",
  priority = false,
}: {
  src: string;
  overlayClassName: string;
  position?: string;
  priority?: boolean;
}) {
  return (
    <>
      <FadeImage
        src={src}
        alt=""
        fill
        sizes="100vw"
        quality={65}
        {...(priority
          ? { priority: true, fetchPriority: "high" as const }
          : { loading: "lazy" as const })}
        className="object-cover"
        style={{ objectPosition: position }}
      />

      <div aria-hidden className={cn("absolute inset-0", overlayClassName)} />
    </>
  );
}
