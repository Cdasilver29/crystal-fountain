import * as React from "react";

/**
 * A native select with a chevron of our own.
 *
 * Deliberately not a custom dropdown. The element inside is the same native
 * select it always was, so the list is drawn by the platform and keyboard
 * users, screen readers and the Android wheel picker all keep working. The
 * wrapper exists only to hang a chevron over the right hand padding, because
 * the arrow has to be an element to be able to turn over when the list opens.
 *
 * The className lands on the wrapper, not on the select. The select is always
 * the full width of the wrapper, so anything that sets a width or a margin has
 * to set it on the thing the select is measured against.
 *
 * Everything else is in .select-field in globals.css, so every select on the
 * site is one rule rather than a class string copied ten times.
 *
 * The class is joined by hand rather than through cn. There is nothing here to
 * merge, and importing cn pulled tailwind-merge into the two admin routes that
 * did not already carry it, which cost ten kilobytes of first load each for a
 * string concatenation.
 */
export function SelectField({
  className,
  children,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <div className={className ? `select-field ${className}` : "select-field"}>
      <select {...props}>{children}</select>

      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="select-field-chevron"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}
