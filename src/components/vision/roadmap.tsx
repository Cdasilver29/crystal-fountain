import {
  Check,
  Church,
  Coins,
  ExternalLink,
  Hammer,
  PenTool,
  Ruler,
  Target,
} from "lucide-react";

import { ROADMAP, type RoadmapIcon } from "@/content/project";
import { cn } from "@/lib/utils";

/**
 * The road map, built from the step data rather than embedded as the flyer.
 *
 * The scan of the flyer is a picture of text: it does not reflow on a phone, it
 * cannot be read by a screen reader, and it cannot say which step the project
 * is on without being redrawn. So the six steps are typed data in
 * src/content/project.ts and this renders them, with a link to the original
 * underneath for anyone who wants the printed sheet.
 *
 * One shape at both widths. A phone gets a vertical timeline with the line down
 * the left; from the medium breakpoint the same line moves to the centre and
 * the cards alternate either side of it. Six cards across a 1024px column would
 * leave about 160px each, which is not enough for "Concept drawing and detailed
 * design", so the path runs downwards at every width and only the side changes.
 *
 * Status is derived from ROADMAP.current, never restated per step: everything
 * before it is complete, that step is where the project is, everything after is
 * upcoming. One number to change when the project moves on.
 *
 * Motion lives in globals.css, keyed off the data-roadmap attribute that
 * RoadmapReveal toggles, and is switched off wholesale under reduced motion.
 */
const ICONS: Record<RoadmapIcon, React.ComponentType<{ className?: string }>> =
  {
    vision: Target,
    planning: Ruler,
    design: PenTool,
    fundraising: Coins,
    construction: Hammer,
    dedication: Church,
  };

export function Roadmap({ reveal }: { reveal: React.ReactNode }) {
  return (
    <section
      id="roadmap"
      className="scroll-mt-16 bg-navy px-4 py-12 sm:px-6 sm:py-16"
    >
      <div className="mx-auto w-full max-w-5xl">
        <h2 className="text-2xl font-semibold tracking-tight text-balance text-white sm:text-3xl">
          {ROADMAP.heading}
        </h2>

        <p className="mt-3 text-base text-white/70 sm:text-lg">
          We are in Step {ROADMAP.current} as of {ROADMAP.asOf}
        </p>

        {reveal}

        <p className="mt-10 text-center md:text-left">
          <a
            href={ROADMAP.original.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center gap-2 rounded-lg text-sm text-white/60 underline-offset-4 transition-colors hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
          >
            <ExternalLink aria-hidden className="size-4 shrink-0" />
            {ROADMAP.original.label}
          </a>
        </p>
      </div>
    </section>
  );
}

/**
 * The steps themselves, kept apart from the section above only so the reveal
 * wrapper can sit between the two without the wrapper knowing what it holds.
 */
export function RoadmapSteps() {
  return (
    <>
      {/*
        The path. Laid out at its full height and scaled down to nothing by the
        armed state, so the animation grows it from the top rather than the
        element depending on the animation to exist at all.
      */}
      <div
        aria-hidden
        className="roadmap-line absolute top-2 bottom-2 left-[19px] w-0.5 rounded-full bg-gradient-to-b from-white/35 via-white/20 to-white/10 md:left-1/2 md:-translate-x-1/2"
      />

      {/*
        A div inside an ol is not what the spec has in mind, but it is how the
        journey timeline on the home page draws its line too, and moving the
        line out would mean positioning it against a different box than the one
        the steps are laid out in.
      */}
      <ol className="relative">
        {ROADMAP.steps.map((step, index) => {
          const Icon = ICONS[step.icon];
          const ordinal = index + 1;
          const isCurrent = ordinal === ROADMAP.current;
          const isDone = ordinal < ROADMAP.current;
          const onLeft = index % 2 === 0;

          return (
            <li
              key={step.title}
              aria-current={isCurrent ? "step" : undefined}
              style={{ "--step": index } as React.CSSProperties}
              className={cn(
                "roadmap-step relative pb-8 pl-14 last:pb-0 md:w-1/2 md:pb-10",
                onLeft
                  ? "md:mr-auto md:pr-14 md:pl-0 md:text-right"
                  : "md:ml-auto md:pl-14",
              )}
            >
              {/*
                The marker on the path. On a phone it sits at the left edge of
                the card; from medium up it moves to whichever edge of the card
                faces the centre line and is pulled half its own width across
                it, which is what puts it on the line rather than beside it.
              */}
              <span
                aria-hidden
                className={cn(
                  "absolute top-0 flex size-10 items-center justify-center rounded-full",
                  onLeft
                    ? "left-0 md:right-0 md:left-auto md:translate-x-1/2"
                    : "left-0 md:-translate-x-1/2",
                  isCurrent &&
                    "roadmap-node-current bg-campfire text-white ring-2 ring-campfire/40",
                  isDone && "bg-treefrog text-white",
                  !isCurrent &&
                    !isDone &&
                    "border border-white/25 bg-white/5 text-white/55",
                )}
              >
                <Icon className="size-5" />

                {isDone && (
                  <span className="absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full bg-treefrog ring-2 ring-navy">
                    <Check className="size-2.5" strokeWidth={3.5} />
                  </span>
                )}
              </span>

              <div
                className={cn(
                  "rounded-2xl border p-4 sm:p-5",
                  isCurrent && "border-campfire bg-campfire/15 shadow-lg",
                  isDone && "border-treefrog/40 bg-treefrog/10",
                  !isCurrent && !isDone && "border-white/15 bg-white/5",
                )}
              >
                <p
                  className={cn(
                    "text-sm font-medium",
                    isCurrent && "text-campfire",
                    isDone && "text-white/70",
                    !isCurrent && !isDone && "text-white/50",
                  )}
                >
                  {step.ordinal}
                </p>

                <h3
                  className={cn(
                    "mt-1 text-base font-semibold text-balance sm:text-lg",
                    isCurrent || isDone ? "text-white" : "text-white/75",
                  )}
                >
                  {step.title}
                </h3>

                {isCurrent && (
                  <p className="mt-2 text-sm font-medium text-campfire">
                    We are here
                  </p>
                )}

                {isDone && (
                  <p className="mt-2 text-sm text-white/60">Complete</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/*
        Without JavaScript the attribute above never leaves its armed state and
        the cards would stay where the entrance was going to bring them in
        from. The rules that hide them are undone here, so a browser with
        scripting off gets the whole road map, just without the animation.
      */}
      <noscript>
        <style
          dangerouslySetInnerHTML={{
            __html:
              "[data-roadmap] .roadmap-step{opacity:1!important;transform:none!important}[data-roadmap] .roadmap-line{scale:none!important}",
          }}
        />
      </noscript>
    </>
  );
}
