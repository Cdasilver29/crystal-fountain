import { FadeImage } from "@/components/media/fade-image";

import { TIMELINE } from "@/content/project";
import { cn } from "@/lib/utils";

/**
 * The campaign timeline, with the scale model beside it.
 *
 * The photograph is the point of the section as much as the dates are: it is
 * what the pledges are for, so it is a real image on the page rather than a
 * wash behind the text. From the medium breakpoint up the heading and the
 * timeline take the left 38 per cent and the model the rest, running past the
 * container to the right edge of the window. That is the one place on the home
 * page the grid is broken, and it should stay the only one: twice reads as an
 * accident. On a phone the model sits inside the container, between the
 * heading and the timeline.
 *
 * The milestones read as a vertical list at every width now. They used to turn
 * horizontal on a wide screen, which worked when they had the full page; in a
 * two fifths column six of them would be unreadable.
 */
export function JourneyTimeline() {
  const currentIndex = TIMELINE.findIndex((milestone) => milestone.current);

  return (
    // overflow-x-clip because 100vw counts the scrollbar, so the bleed runs
    // half a scrollbar past the window. clip rather than hidden, which would
    // make the section a scroll container.
    <section className="overflow-x-clip bg-[#0a2c63] page-gutter section">
      {/* A size container, so the bleed below can measure it in cqw. */}
      <div className="@container container-marketing">
        <div className="grid gap-8 md:grid-cols-[38fr_62fr] md:grid-rows-[auto_1fr] md:gap-x-16 md:gap-y-6">
          <h2
            data-reveal=""
            className="font-display text-xl font-semibold text-balance text-white sm:text-3xl md:col-start-1 md:row-start-1"
          >
            From vision to reality
          </h2>

          {/*
            The file's own ratio, so nothing is cropped here. The crop happened
            once, in the file: the square original ended in a white nameplate
            reading "The Crystal Fountain, Sanctuary and Centre of Influence",
            which the heading beside it already says. It is cut at the dark rim
            of the plinth, so the model sits on its own base.

            On a wide window the bleed makes the frame wider than the column,
            and its height is capped so it does not outgrow the section. What
            the cap crops comes mostly off the bottom, the plinth and the lawn,
            since the top of the tower sits close to the top of the file.

            The extra width is the distance from the container to the edge
            of the window, half the window less half the container.
          */}
          <div
            data-reveal=""
            className="relative aspect-[1254/1028] w-full overflow-hidden rounded-2xl shadow-lg ring-1 ring-white/10 md:col-start-2 md:row-span-2 md:row-start-1 md:w-[calc(100%+50vw-50cqw)] md:max-h-[44rem] md:max-w-none md:rounded-r-none">
            <FadeImage
              src="/images/gallery/vision-reality.jpg"
              alt="The scale model of the Crystal Fountain Cathedral and Centre, the sanctuary in front of the tower, on its plinth in the church lobby"
              fill
              sizes="(max-width: 768px) 100vw, 70vw"
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
          <ol data-reveal="" className="relative md:col-start-1 md:row-start-2">
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
