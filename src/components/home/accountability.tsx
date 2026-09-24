import { FadeImage } from "@/components/media/fade-image";

import { DEVELOPMENT_LEADER, OVERSIGHT_SHORT } from "@/content/leadership";

/**
 * Who is answerable for the money, led by his photograph.
 *
 * A named person with a phone number that dials, on a page asking for
 * KES 550M, is the point of this section, so it is the sparsest on the page:
 * a face, a name, a number, and one short paragraph. It stays under 320px
 * tall on a desktop. Anything longer belongs on /vision.
 *
 * The quote is DEVELOPMENT_LEADER.quote in src/content/leadership.ts. Empty,
 * it renders nothing and the name sits directly under the heading.
 */
export function Accountability() {
  const leader = DEVELOPMENT_LEADER;

  return (
    <section className="bg-[#f8f7f5] page-gutter py-12 sm:py-14">
      <div data-reveal="" className="container-marketing">
        <div className="flex items-center gap-5 sm:gap-7">
          {/*
            The file is a half length portrait, so it is drawn larger than the
            circle and zoomed toward the face, which sits a quarter of the way
            down.
          */}
          <div className="relative size-24 shrink-0 overflow-hidden rounded-full bg-navy ring-1 ring-black/5 sm:size-[120px]">
            <FadeImage
              src={leader.photo.src}
              alt={leader.photo.alt}
              width={240}
              height={240}
              loading="lazy"
              className="size-full origin-[52%_24%] scale-[1.7] object-cover"
            />
          </div>

          <div className="min-w-0">
            <h2 className="text-sm font-medium text-neutral-500">
              Who is responsible
            </h2>

            {leader.quote && (
              <blockquote className="mt-2 max-w-xl text-lg leading-snug text-pretty text-navy italic sm:text-xl">
                <p>{leader.quote}</p>
              </blockquote>
            )}

            <p className="mt-2 text-lg font-semibold text-navy">
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
            </p>
          </div>
        </div>

        <p className="mt-6 max-w-2xl text-sm leading-relaxed text-neutral-500">
          {OVERSIGHT_SHORT}
        </p>
      </div>
    </section>
  );
}
