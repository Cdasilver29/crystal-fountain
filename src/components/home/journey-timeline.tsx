import { FadeImage } from "@/components/media/fade-image";

import { TIMELINE } from "@/content/project";
import { cn } from "@/lib/utils";

/**
 * The campaign timeline, with the scale model beside it.
 *
 * The photograph is the point of the section as much as the dates are: it is
 * what the pledges are for, so it is a real image on the page rather than a
 * wash behind the text. From the large breakpoint up the heading and the
 * timeline take the left 45 per cent and the model the rest, top aligned and
 * inside the container like everything else on the page. It used to run past
 * the container to the window's edge, and at 1280px that read as a picture
 * cut off by mistake rather than a picture breaking the grid on purpose.
 * Below the large breakpoint the model sits between the heading and the
 * timeline.
 *
 * The milestones read as a vertical list at every width.
 */
export function JourneyTimeline() {
  const currentIndex = TIMELINE.findIndex((milestone) => milestone.current);

  return (
    <section className="bg-[#0a2c63] page-gutter section">
      <div className="container-marketing">
        <div className="grid gap-6 lg:grid-cols-[45fr_55fr] lg:grid-rows-[auto_1fr] lg:items-start lg:gap-x-16">
          <h2
            data-reveal=""
            className="font-display text-xl font-semibold text-balance text-white sm:text-3xl lg:col-start-1 lg:row-start-1"
          >
            From vision to reality
          </h2>

          {/*
            The file's own ratio, so nothing is cropped on a narrow screen. The
            crop happened once, in the file: the square original ended in a
            white nameplate reading "The Crystal Fountain, Sanctuary and Centre
            of Influence", which the heading beside it already says. It is cut
            at the dark rim of the plinth, so the model sits on its own base.

            The height is capped at 480px so the picture cannot make the
            section taller than the timeline needs. What the cap crops comes
            mostly off the bottom, the plinth and the lawn, since the top of
            the tower sits close to the top of the file.
          */}
          <div
            data-reveal=""
            className="relative aspect-[1254/1028] max-h-[30rem] w-full overflow-hidden rounded-2xl shadow-lg ring-1 ring-white/10 lg:col-start-2 lg:row-span-2 lg:row-start-1"
          >
            <FadeImage
              src="/images/gallery/vision-reality.jpg"
              alt="The scale model of the Crystal Fountain Cathedral and Centre, the sanctuary in front of the tower, on its plinth in the church lobby"
              fill
              sizes="(min-width: 1024px) 560px, 100vw"
              quality={75}
              loading="lazy"
              className="object-cover object-[50%_35%]"
            />
          </div>

          {/*
            Its own reveal rather than a stagger with the picture, because on a
            phone the list sits a screen below it and its dots would draw
            themselves off screen.
          */}
          <ol data-reveal="" className="lg:col-start-1 lg:row-start-2">
            {TIMELINE.map((milestone, index) => {
              const isCurrent = index === currentIndex;
              const isPast = currentIndex >= 0 && index < currentIndex;

              return (
                <li
                  key={milestone.when}
                  aria-current={isCurrent ? "step" : undefined}
                  className="relative pb-5 pl-8 last:pb-0"
                >
                  {/*
                    The line is drawn per milestone, from the foot of this dot
                    to the top of the next, so it ends at the last dot rather
                    than running on to the bottom of the list.
                  */}
                  {index < TIMELINE.length - 1 && (
                    <span
                      aria-hidden
                      className="absolute top-[18px] -bottom-1 left-[6px] w-0.5 bg-white/30"
                    />
                  )}

                  <p className="text-sm leading-6 font-medium text-white/60">
                    {milestone.when}
                  </p>

                  <span
                    aria-hidden
                    style={{ "--i": index } as React.CSSProperties}
                    className={cn(
                      "milestone-dot absolute top-1 left-0 size-3.5 rounded-full",
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
