import type { ReactNode } from "react";

/**
 * The shape shared by the 404 and the error screens: a navy page head with the
 * heading and one line under it, then the ways out.
 *
 * Built from the same page head, gutter and container as every other page, so
 * a missing page or a failed render still looks like part of the site rather
 * than a crash. Takes no error, message or stack on purpose: nothing about
 * what went wrong is ever shown to a visitor.
 */
export function StatusPage({
  title,
  lead,
  actions,
  footnote,
  width = "container-marketing",
}: {
  title: string;
  lead: string;
  actions: ReactNode;
  footnote?: ReactNode;
  width?: "container-marketing" | "container-table";
}) {
  return (
    <div className="flex flex-1 flex-col bg-white">
      <header className="bg-navy page-gutter section-feature">
        <div className={width}>
          <h1 className="text-3xl font-semibold tracking-tight text-white">
            {title}
          </h1>
          <p className="container-prose mx-0 mt-2 text-white/70">{lead}</p>
        </div>
      </header>

      <div className="page-gutter section">
        <div className={width}>
          <div className="flex flex-wrap gap-3">{actions}</div>

          {footnote && (
            <p className="container-prose mx-0 mt-8 text-sm leading-relaxed text-neutral-600">
              {footnote}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** The warm action on a status page. One per page. */
export const STATUS_PRIMARY =
  "btn-primary inline-flex h-12 items-center justify-center whitespace-nowrap bg-campfire px-6 text-base font-semibold text-white focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-offset-2 focus-visible:outline-none";

/** Every other way out. */
export const STATUS_SECONDARY =
  "btn-secondary inline-flex h-12 cursor-pointer items-center justify-center whitespace-nowrap border border-neutral-300 bg-white px-6 text-base font-medium text-navy focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-offset-2 focus-visible:outline-none";

/** An inline link inside the footnote. */
export const STATUS_INLINE =
  "rounded font-medium text-denim underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none";
