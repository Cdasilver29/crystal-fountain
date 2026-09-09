/**
 * The download control for a CSV export.
 *
 * An ordinary anchor, not a button with a click handler. The endpoint answers
 * with Content-Disposition: attachment, which is what makes the browser save
 * the file instead of navigating to it, so this needs no JavaScript, works with
 * scripting off, and can be opened in a new tab or copied like any other link.
 *
 * Rendered only for a treasurer or an admin, but that is presentation. The
 * endpoint makes the same check and writes an admin.forbidden row if a viewer
 * requests it directly.
 */
export function ExportButton({
  href,
  label = "Download CSV",
}: {
  href: string;
  label?: string;
}) {
  return (
    <a
      href={href}
      // Downloads regardless, because of the response header. Naming it here
      // too means a browser that ignores the header still saves something
      // sensibly named rather than showing a wall of commas.
      download
      className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 text-sm font-medium text-navy transition-colors hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="size-4"
      >
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 21h14" />
      </svg>
      {label}
    </a>
  );
}
