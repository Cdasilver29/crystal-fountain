import { z } from "zod";

import { eventSeries, findSeries } from "@/content/updates";
import { problem } from "@/lib/api";
import { SITE_URL } from "@/lib/metadata";
import { sessionCalendar, sessionCalendarFilename } from "@/lib/updates/ics";

/**
 * GET /api/updates/:seriesId/session-:number/calendar.ics
 *
 * The "Add to calendar" file for one session. The sessions are content in the
 * repo, so every file is built once at build time and served static; a series
 * or session that is not in the content is a 404, not a render.
 */

const calendarParams = z.object({
  series: z.string().regex(/^[a-z0-9-]{1,64}$/),
  session: z.string().regex(/^session-([1-9][0-9]?)$/),
});

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return eventSeries.flatMap((series) =>
    series.sessions.map((session) => ({
      series: series.id,
      session: `session-${session.number}`,
    })),
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ series: string; session: string }> },
) {
  const parsed = calendarParams.safeParse(await params);
  const series = parsed.success ? findSeries(parsed.data.series) : undefined;
  const session = series?.sessions.find(
    (candidate) => parsed.success && `session-${candidate.number}` === parsed.data.session,
  );

  if (!series || !session) {
    return problem(404, "session_not_found", "That session is not on the calendar.");
  }

  const body = sessionCalendar(series, session, {
    siteUrl: SITE_URL,
    stampedAt: new Date(),
  });

  return new Response(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${sessionCalendarFilename(series, session)}"`,
    },
  });
}
