import { SectionBackground } from "@/components/media/section-background";
import { TIMELINE } from "@/content/project";
import { cn } from "@/lib/utils";

/**
 * The campaign timeline.
 *
 * Vertical on a phone with the line down the left and milestones branching
 * right, horizontal from the medium breakpoint up with the date above the line
 * and the description below it.
 *
 * The date row is a fixed 1.5rem on desktop so the line can be positioned at
 * the centre of the dots deterministically, rather than depending on where the
 * longest date happens to wrap.
 */
export function JourneyTimeline() {
  const currentIndex = TIMELINE.findIndex((milestone) => milestone.current);

  return (
    <section className="relative overflow-hidden bg-[#0a2c63] px-4 py-16 sm:px-6 sm:py-20">
      <SectionBackground
        src="/images/gallery/Vision.PNG"
        overlayClassName="bg-[#0a2c63]/[0.78]"
      />

      <div className="relative z-10 mx-auto w-full max-w-5xl">
        <h2 className="text-2xl font-semibold tracking-tight text-balance text-white sm:text-4xl">
          From vision to reality
        </h2>

        <ol className="relative mt-12 md:flex md:gap-6">
          <div
            aria-hidden
            className="absolute top-0 bottom-0 left-[7px] w-0.5 bg-white/30 md:top-[31px] md:right-0 md:bottom-auto md:left-0 md:h-0.5 md:w-auto"
          />

          {TIMELINE.map((milestone, index) => {
            const isCurrent = index === currentIndex;
            const isPast = currentIndex >= 0 && index < currentIndex;

            return (
              <li
                key={milestone.when}
                aria-current={isCurrent ? "step" : undefined}
                className="relative pb-9 pl-8 last:pb-0 md:flex-1 md:pb-0 md:pl-0"
              >
                <p className="text-sm leading-6 font-medium text-white/60 md:h-6">
                  {milestone.when}
                </p>

                <span
                  aria-hidden
                  className={cn(
                    // Desktop: the 1.5rem date row puts the dot centre at
                    // 31px, which is where the line is drawn.
                    "absolute top-1 left-0 size-3.5 rounded-full md:top-6",
                    isCurrent && "milestone-pulse scale-125 bg-campfire",
                    isPast && "bg-white",
                    !isCurrent && !isPast && "border-2 border-white/50",
                  )}
                />

                <p
                  className={cn(
                    "mt-1 text-base md:mt-7",
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
    </section>
  );
}
