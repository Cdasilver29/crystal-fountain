import Image from "next/image";

import { TIMELINE } from "@/content/project";
import { cn } from "@/lib/utils";

/**
 * The campaign timeline, with the site beside it.
 *
 * The photograph is the point of the section as much as the dates are: it is
 * what the pledges are for, so it is a real image on the page at the size of
 * the content rather than a wash behind the text. Sixty forty from the medium
 * breakpoint up, stacked with the image first on a phone.
 *
 * The milestones read as a vertical list at every width now. They used to turn
 * horizontal on a wide screen, which worked when they had the full page; in a
 * two fifths column six of them would be unreadable.
 */
export function JourneyTimeline() {
  const currentIndex = TIMELINE.findIndex((milestone) => milestone.current);

  return (
    <section className="bg-[#0a2c63] px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto w-full max-w-5xl">
        <h2 className="text-2xl font-semibold tracking-tight text-balance text-white sm:text-4xl">
          From vision to reality
        </h2>

        <div className="mt-10 grid gap-10 md:grid-cols-[3fr_2fr] md:items-start md:gap-12">
          {/*
            The file's own ratio, so nothing is cropped here. The crop happened
            once, in the file: the square original ended in a white nameplate
            reading "The Crystal Fountain, Sanctuary and Centre of Influence",
            which the heading beside it already says. It is cut at the dark rim
            of the plinth, so the model sits on its own base.
          */}
          <div className="relative aspect-[1254/1028] w-full overflow-hidden rounded-2xl shadow-lg ring-1 ring-white/10">
            <Image
              src="/images/gallery/vision-reality.jpg"
              alt="The scale model of the Crystal Fountain Cathedral and Centre, the sanctuary in front of the tower, on its plinth in the church lobby"
              fill
              sizes="(max-width: 768px) 100vw, 60vw"
              quality={75}
              loading="lazy"
              className="object-cover object-center"
            />
          </div>

          <ol className="relative">
            <div
              aria-hidden
              className="absolute top-0 bottom-0 left-[7px] w-0.5 bg-white/30"
            />

            {TIMELINE.map((milestone, index) => {
              const isCurrent = index === currentIndex;
              const isPast = currentIndex >= 0 && index < currentIndex;

              return (
                <li
                  key={milestone.when}
                  aria-current={isCurrent ? "step" : undefined}
                  className="relative pb-9 pl-8 last:pb-0"
                >
                  <p className="text-sm leading-6 font-medium text-white/60">
                    {milestone.when}
                  </p>

                  <span
                    aria-hidden
                    className={cn(
                      "absolute top-1 left-0 size-3.5 rounded-full",
                      isCurrent && "milestone-pulse scale-125 bg-campfire",
                      isPast && "bg-white",
                      !isCurrent && !isPast && "border-2 border-white/50",
                    )}
                  />

                  <p
                    className={cn(
                      "mt-1 text-base",
                      isCurrent ? "font-semibold text-white" : "text-white/80",
                    )}
                  >
                    {milestone.what}
                  </p>

                  {isCurrent && (
                    <p className="mt-1 text-sm font-medium text-campfire">
                      We are here
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
