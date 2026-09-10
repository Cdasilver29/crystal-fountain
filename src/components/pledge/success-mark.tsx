/**
 * The green checkmark on the confirmation page.
 *
 * Inline SVG with two stroke-dashoffset animations defined in globals.css: the
 * ring draws itself over 900ms and the tick strokes in behind it over the next
 * 600ms, one and a half seconds in total. No library, no image, no JavaScript,
 * and nothing that needs the client boundary, so this stays a server component.
 *
 * Decorative rather than informative. The heading beside it already says the
 * pledge is recorded, so a screen reader announcing a checkmark as well would
 * only say it twice.
 */
export function SuccessMark() {
  return (
    <svg
      viewBox="0 0 64 64"
      className="mx-auto size-20 sm:size-24"
      fill="none"
      aria-hidden
      focusable="false"
    >
      <circle
        cx="32"
        cy="32"
        r="26"
        // 2 pi r is 163.4, and the dash array in the stylesheet rounds up to
        // 166 so the ring closes rather than leaving a hairline gap.
        className="success-ring stroke-green-600"
        strokeWidth="4"
        strokeLinecap="round"
        transform="rotate(-90 32 32)"
      />
      <path
        d="M20 33.5 L28.5 42 L44 24"
        className="success-tick stroke-green-600"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
