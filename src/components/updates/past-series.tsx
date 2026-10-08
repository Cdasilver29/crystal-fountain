import { Check } from "lucide-react";

import type { SeriesView } from "@/lib/updates/status";
import { sessionDate } from "@/lib/updates/status";

/** A series whose every session has been held. Kept as a record, not an invitation. */
export function PastSeries({ view }: { view: SeriesView }) {
  const { series, sessions } = view;
  const first = sessionDate(sessions[0]!.startsAt);
  const last = sessionDate(sessions.at(-1)!.startsAt);

  return (
    <li id={series.id} className="scroll-mt-28 rounded-xl border border-neutral-200 bg-neutral-50 px-5 py-4">
      <h3 className="font-display text-lg font-semibold text-navy">{series.name}</h3>
      <p className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-neutral-600">
        <Check aria-hidden className="size-4" />
        All {sessions.length} sessions held,{" "}
        {first.year === last.year ? `${first.day} ${first.month}` : first.long} to {last.long}
      </p>
      <p className="mt-1 text-sm text-neutral-600">
        {series.venue.name}, {series.venue.streetAddress}
      </p>
    </li>
  );
}
