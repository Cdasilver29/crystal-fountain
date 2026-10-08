import { CalendarPlus, Check, Clock, Mail, MapPin, Navigation } from "lucide-react";

import {
  attendanceMailto,
  calendarPath,
  directionsUrl,
  sessionOrdinal,
  shareText,
  whatsappShareUrl,
} from "@/lib/updates/links";
import {
  SESSION_STATUS_LABEL,
  type SeriesView,
  type SessionView,
  featuredChip,
  sessionDate,
} from "@/lib/updates/status";

import { ShareSessionLink } from "./share-session-link";

const SECONDARY_ACTION =
  "btn-secondary inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-denim/30 bg-white px-4 text-sm font-medium text-navy focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none";

/**
 * The session to act on, and the run of sessions under it.
 *
 * Every status here arrived as text from the server. Nothing in this file reads
 * the clock, so there is nothing for the browser to recompute differently.
 */
export function SeriesFeature({ view, siteUrl }: { view: SeriesView; siteUrl: string }) {
  const { series, featured } = view;
  if (!featured) return null;

  const date = sessionDate(featured.startsAt);
  const text = shareText(series, featured, siteUrl);

  return (
    <div className="mx-auto w-full max-w-[880px]">
      <article
        id={series.id}
        aria-labelledby={`${series.id}-heading`}
        className="scroll-mt-28 flex flex-col gap-5 rounded-2xl border-2 border-campfire bg-white p-5 shadow-sm sm:flex-row sm:gap-7 sm:p-7"
      >
        <div className="flex w-full shrink-0 items-baseline gap-3 rounded-xl bg-navy px-5 py-4 text-white sm:w-32 sm:flex-col sm:items-center sm:justify-center sm:gap-1 sm:text-center">
          <span className="text-sm font-medium text-white/80">{date.weekday}</span>
          <span className="font-display text-5xl leading-none font-semibold">{date.day}</span>
          <span className="text-sm text-white/80">
            {date.month} {date.year}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <p className="inline-flex rounded-full border border-campfire/50 bg-campfire/5 px-3 py-1 text-sm font-semibold text-navy">
            {featuredChip(view)}
          </p>
          <p className="mt-3 text-sm font-medium text-neutral-600">
            {sessionOrdinal(series, featured)}
          </p>
          <h2
            id={`${series.id}-heading`}
            className="mt-1 font-display text-2xl font-semibold text-balance text-navy sm:text-3xl"
          >
            {series.name}
          </h2>

          <ul className="mt-4 space-y-2 text-base text-neutral-700">
            <li className="flex items-start gap-2">
              <Clock aria-hidden className="mt-1 size-4 shrink-0 text-denim" />
              <span>
                <time dateTime={featured.startsAt}>
                  {date.full}, {date.time}
                </time>
              </span>
            </li>
            <li className="flex items-start gap-2">
              <MapPin aria-hidden className="mt-1 size-4 shrink-0 text-denim" />
              <span>
                {series.venue.name}, {series.venue.streetAddress}
              </span>
            </li>
          </ul>

          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href={attendanceMailto(series, featured)}
              className="btn-primary inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-campfire px-5 text-base font-semibold text-white focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-offset-2 focus-visible:outline-none sm:w-auto"
            >
              <Mail aria-hidden className="size-4" />
              Confirm attendance
            </a>
            <a href={calendarPath(series, featured)} download className={SECONDARY_ACTION}>
              <CalendarPlus aria-hidden className="size-4" />
              Add to calendar
            </a>
            <a
              href={directionsUrl(series)}
              target="_blank"
              rel="noopener noreferrer"
              className={SECONDARY_ACTION}
            >
              <Navigation aria-hidden className="size-4" />
              Directions
            </a>
            <ShareSessionLink
              whatsappUrl={whatsappShareUrl(text)}
              title={series.name}
              text={text}
              className={SECONDARY_ACTION}
            >
              Share
            </ShareSessionLink>
          </div>
        </div>
      </article>

      <SeriesStrip view={view} />
    </div>
  );
}

const TILE_STYLE: Record<SessionView["status"], string> = {
  held: "border border-neutral-200 bg-neutral-100 text-neutral-500",
  today: "border-2 border-campfire bg-white text-navy",
  next: "border-2 border-campfire bg-white text-navy",
  upcoming: "border border-neutral-200 bg-white text-navy",
};

/** Every session as a tile, each carrying its status in words. */
export function SeriesStrip({ view }: { view: SeriesView }) {
  return (
    <div className="mt-6">
      <ol
        aria-label={`${view.series.shortName} sessions`}
        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
      >
        {view.sessions.map((session) => (
          <li
            key={session.number}
            aria-current={session.status === "next" || session.status === "today" ? "date" : undefined}
            className={`rounded-xl px-4 py-3 ${TILE_STYLE[session.status]}`}
          >
            <p className="text-sm font-semibold">Session {session.number}</p>
            <p className="mt-0.5 text-sm">
              <time dateTime={session.startsAt}>{sessionDate(session.startsAt).short}</time>
            </p>
            <p
              className={`mt-2 inline-flex items-center gap-1 text-sm font-medium ${
                session.status === "held" ? "" : session.status === "upcoming" ? "text-neutral-600" : "font-semibold"
              }`}
            >
              {session.status === "held" && <Check aria-hidden className="size-4" />}
              {SESSION_STATUS_LABEL[session.status]}
            </p>
          </li>
        ))}
      </ol>
      {view.series.scheduleNote && (
        <p className="mt-3 text-sm text-neutral-600">{view.series.scheduleNote}</p>
      )}
    </div>
  );
}
