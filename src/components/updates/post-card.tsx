import { Mail } from "lucide-react";

import type { EventSeries, Post, PostKind } from "@/content/updates";
import { formatDayKey } from "@/lib/updates/status";

import { CopyEmailButton } from "./copy-email-button";

const KIND_LABEL: Record<PostKind, string> = {
  announcement: "Announcement",
  progress: "Progress",
  event: "Event",
};

/** One update. A post about an event series repeats where to confirm attendance. */
export function PostCard({ post, series }: { post: Post; series?: EventSeries }) {
  return (
    <article
      id={post.slug}
      aria-labelledby={`${post.slug}-title`}
      className="scroll-mt-28 rounded-2xl border border-neutral-200 bg-white p-5 sm:p-7"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="rounded-full bg-denim/10 px-2.5 py-0.5 font-medium text-denim">
          {KIND_LABEL[post.kind]}
        </span>
        <time dateTime={post.postedOn} className="text-neutral-600">
          {formatDayKey(post.postedOn)}
        </time>
      </div>

      <h3
        id={`${post.slug}-title`}
        className="mt-3 font-display text-xl font-semibold text-balance text-navy sm:text-2xl"
      >
        {post.title}
      </h3>

      <div className="mt-3 max-w-[680px] space-y-3 text-base leading-relaxed text-neutral-700">
        {post.body.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>

      {series && (
        <div className="mt-5 flex max-w-[680px] flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-neutral-50 px-4 py-3">
          <Mail aria-hidden className="size-4 shrink-0 text-denim" />
          <a
            href={`mailto:${series.attendanceEmail}`}
            className="min-w-0 rounded text-base break-all text-denim underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
          >
            {series.attendanceEmail}
          </a>
          <CopyEmailButton email={series.attendanceEmail} />
        </div>
      )}
    </article>
  );
}
