import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * A photographic backdrop for a full width section.
 *
 * The source files are 900kB to 2.5MB PNGs, so nothing here links a raw file:
 * the image goes through next/image, which serves a WebP at the width the
 * viewport actually needs. It is laid out with fill inside a positioned,
 * clipped section, so it takes no space of its own and cannot shift the
 * content or push the page sideways on a narrow screen.
 *
 * The overlay is a separate layer above the image and below the content, so
 * the section keeps its own colour and the text on top stays readable whatever
 * the photograph is doing underneath. Every backdrop except the hero is lazy:
 * they are all below the fold.
 *
 * The caller is responsible for two things: the section must be relative and
 * overflow hidden, and the content must sit on a higher layer.
 */
export function SectionBackground({
  src,
  overlayClassName,
}: {
  src: string;
  overlayClassName: string;
}) {
  return (
    <>
      <Image
        src={src}
        alt=""
        fill
        sizes="100vw"
        quality={65}
        loading="lazy"
        className="object-cover object-center"
      />

      <div aria-hidden className={cn("absolute inset-0", overlayClassName)} />
    </>
  );
}
