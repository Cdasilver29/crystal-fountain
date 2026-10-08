import type { Metadata } from "next";

import { SectionBackground } from "@/components/media/section-background";
import { RevealOnScroll } from "@/components/motion/reveal-on-scroll";
import { JsonLd } from "@/components/seo/json-ld";
import { PledgeCta } from "@/components/site/pledge-cta";
import { PastSeries } from "@/components/updates/past-series";
import { PostCard } from "@/components/updates/post-card";
import { SeriesFeature } from "@/components/updates/series-feature";
import { eventSeries, findSeries, posts } from "@/content/updates";
import { SITE_URL, pageMetadata } from "@/lib/metadata";
import { sessionEventSchema } from "@/lib/structured-data";
import { seriesView, sessionDate } from "@/lib/updates/status";

/*
 * Statuses are worked out from the clock at render, so the page is rebuilt at
 * most an hour after a session's day turns over. Nobody has to edit anything
 * for Session 2 to become Held and Session 3 to become Next.
 */
export const revalidate = 3600;

function views(now: Date) {
  const all = eventSeries.map((series) => seriesView(series, now));
  return {
    current: all.filter((view) => !view.isPast),
    past: all.filter((view) => view.isPast),
  };
}

export function generateMetadata(): Metadata {
  const next = views(new Date()).current.find((view) => view.featured);
  if (!next?.featured) {
    return pageMetadata({
      title: "Updates",
      description:
        "Updates on funding, design, and construction progress for the Crystal Fountain Development Project.",
      path: "/updates",
    });
  }

  const date = sessionDate(next.featured.startsAt);
  return pageMetadata({
    title: `${next.series.shortName} and updates`,
    description: `Session ${next.featured.number} of the ${next.series.name} is on ${date.full} at ${date.time}, ${next.series.venue.name}. News from the Crystal Fountain Development Project.`,
    path: "/updates",
  });
}

export default function UpdatesPage() {
  const { current, past } = views(new Date());
  const newestFirst = [...posts].sort((a, b) => b.postedOn.localeCompare(a.postedOn));

  return (
    <>
      {current.flatMap((view) =>
        view.sessions
          .filter((session) => session.status !== "held")
          .map((session) => (
            <JsonLd
              key={`${view.series.id}-${session.number}`}
              data={sessionEventSchema(view.series, session)}
            />
          )),
      )}

      <section className="relative isolate overflow-hidden bg-navy page-gutter section">
        <SectionBackground
          src="/images/heroes/updates.jpg"
          overlayClassName="bg-navy/[0.75]"
          position="30% 50%"
          priority
        />

        {/* The 880px column the card and posts sit in, so the heading shares
            their left edge; the heading keeps the prose measure inside it. */}
        <div className="container-marketing relative z-10">
          <div className="mx-auto max-w-[880px]">
            <h1 className="max-w-[680px] font-display text-3xl font-semibold text-balance text-white sm:text-4xl">
              Project updates
            </h1>
          </div>
        </div>
      </section>

      {current.length > 0 && (
        <section className="bg-neutral-50 page-gutter section">
          <div className="container-marketing space-y-12">
            {current.map((view) => (
              <SeriesFeature key={view.series.id} view={view} siteUrl={SITE_URL} />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="latest-updates" className="bg-white page-gutter section">
        <div className="container-marketing">
          <div className="mx-auto max-w-[880px]">
            <h2
              id="latest-updates"
              className="font-display text-2xl font-semibold text-navy sm:text-3xl"
            >
              Latest updates
            </h2>
            <div className="mt-6 space-y-6">
              {newestFirst.map((post) => (
                <PostCard
                  key={post.slug}
                  post={post}
                  series={post.seriesId ? findSeries(post.seriesId) : undefined}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {past.length > 0 && (
        <section aria-labelledby="past-events" className="bg-white page-gutter pb-16">
          <div className="container-marketing">
            <div className="mx-auto max-w-[880px]">
              <h2
                id="past-events"
                className="font-display text-2xl font-semibold text-navy sm:text-3xl"
              >
                Past events
              </h2>
              <ul className="mt-6 space-y-3">
                {past.map((view) => (
                  <PastSeries key={view.series.id} view={view} />
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}

      <PledgeCta heading="Record your pledge" />
      <RevealOnScroll />
    </>
  );
}
