import Image from "next/image";

import { CONTACT } from "@/content/campaign";
import { ACCOUNTABILITY } from "@/content/project";

/**
 * Who is answerable for the money.
 *
 * A named person with a phone number that dials, on a page asking for
 * KES 550M, is the point of this section. It is set as a card rather than a
 * line of text so it reads as a way to reach someone.
 *
 * The photograph sits beside the copy at roughly forty five per cent from the
 * medium breakpoint up. On a phone it caps at 300px and crops rather than
 * taking half the screen before a visitor has read a word.
 */
export function Accountability() {
  return (
    <section className="bg-[#f8f7f5] px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto w-full max-w-5xl">
        <div className="grid gap-8 md:grid-cols-[9fr_11fr] md:items-start md:gap-12">
          {/*
            Fixed height on a phone, the file's own three by two above it, so
            the picture is never squashed and the row it occupies is known
            before it loads.
          */}
          <div className="relative h-[300px] w-full overflow-hidden rounded-2xl shadow-sm ring-1 ring-black/5 md:h-auto md:aspect-[3/2]">
            <Image
              src="/images/gallery/Accountability.PNG"
              alt="The Crystal Fountain site from above, the tower and centre behind the perimeter wall"
              fill
              sizes="(max-width: 768px) 100vw, 45vw"
              quality={75}
              loading="lazy"
              className="object-cover object-center"
            />
          </div>

          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-navy sm:text-3xl">
              Accountability and transparency
            </h2>

            <p className="mt-5 text-base leading-relaxed text-neutral-700">
              {ACCOUNTABILITY.oversight}
            </p>

            <p className="mt-4 text-base leading-relaxed text-neutral-700">
              {ACCOUNTABILITY.updates}
            </p>

            <div className="mt-8 flex max-w-md items-center gap-4 rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
              <span
                aria-hidden
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-campfire/10 text-campfire"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="size-5"
                >
                  <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
                </svg>
              </span>

              <div className="min-w-0">
                <p className="text-base font-medium text-navy">
                  {CONTACT.leaderName}
                </p>
                <p className="text-sm text-neutral-500">{CONTACT.leaderRole}</p>
                <a
                  href={CONTACT.phoneHref}
                  className="tabular mt-1 inline-block rounded text-base text-denim underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
                >
                  {CONTACT.phoneDisplay}
                </a>
              </div>
            </div>

            <p className="mt-6 text-sm leading-relaxed text-neutral-600">
              For general enquiries: {CONTACT.churchName}, {CONTACT.address}.{" "}
              <a
                href={`mailto:${CONTACT.email}`}
                className="rounded text-denim underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
              >
                {CONTACT.email}
              </a>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
