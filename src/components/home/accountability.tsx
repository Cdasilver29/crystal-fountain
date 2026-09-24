import { FadeImage } from "@/components/media/fade-image";

import { CONTACT } from "@/content/campaign";
import { DEVELOPMENT_LEADER, OVERSIGHT_SHORT } from "@/content/leadership";

/**
 * Who is answerable for the money, led by his photograph.
 *
 * A named person with a phone number that dials, on a page asking for
 * KES 550M, is the point of this section, so it carries little else:
 * a face, his statement, a name, a number, and one short paragraph.
 *
 * The statement is DEVELOPMENT_LEADER.statement in src/content/leadership.ts,
 * one entry per paragraph. Empty, it renders nothing and the name sits
 * directly under the heading.
 */
export function Accountability() {
  const leader = DEVELOPMENT_LEADER;

  return (
    <section className="bg-[#f8f7f5] page-gutter py-12 sm:py-14">
      <div data-reveal="" className="container-marketing">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-8">
          {/*
            The file is a half length portrait, so it is drawn larger than the
            circle and zoomed from near the top edge, so the whole head stays in
            frame with the shoulders below it.
          */}
          <div className="relative size-24 shrink-0 overflow-hidden rounded-full bg-navy ring-1 ring-black/5 sm:size-[120px]">
            <FadeImage
              src={leader.photo.src}
              alt={leader.photo.alt}
              width={240}
              height={240}
              loading="lazy"
              className="size-full origin-[50%_5%] scale-[1.4] object-cover"
            />
          </div>

          <div className="min-w-0">
            <h2 className="text-sm font-medium text-neutral-500">
              Who is responsible
            </h2>

            {leader.statement.length > 0 && (
              <blockquote className="mt-3 max-w-2xl space-y-2 border-l-2 border-campfire pl-5 text-lg leading-snug text-pretty text-navy sm:text-xl">
                {leader.statement.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </blockquote>
            )}

            <p className="mt-5 text-lg font-semibold text-navy">
              {leader.name}
            </p>
            <p className="text-sm text-neutral-600">
              {leader.role}
              <span aria-hidden className="mx-2 text-neutral-300">
                |
              </span>
              <a
                href={leader.phoneHref}
                className="tabular rounded text-denim underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
              >
                {leader.phoneDisplay}
              </a>
              <span aria-hidden className="mx-2 text-neutral-300">
                |
              </span>
              <a
                href={`mailto:${CONTACT.developmentEmail}`}
                className="rounded break-all text-denim underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
              >
                {CONTACT.developmentEmail}
              </a>
            </p>
          </div>
        </div>

        <p className="mt-8 max-w-2xl text-sm leading-relaxed text-neutral-500">
          {OVERSIGHT_SHORT}
        </p>
      </div>
    </section>
  );
}
