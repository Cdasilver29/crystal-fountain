import { KEY_NUMBERS } from "@/content/project";

/**
 * The four numbers that describe the project.
 *
 * No icons, no borders, no cards. The numerals are the whole design, so they
 * are set large in tabular figures and given room, and the labels stay quiet
 * underneath them.
 */
export function KeyNumbers() {
  return (
    <section className="bg-navy px-4 py-16 sm:px-6 sm:py-20">
      <dl className="mx-auto grid w-full max-w-5xl grid-cols-2 gap-x-6 gap-y-12 md:grid-cols-4">
        {KEY_NUMBERS.map((number) => (
          <div key={number.label}>
            <dt className="sr-only">{number.label}</dt>
            <dd>
              <span className="tabular block text-2xl font-semibold tracking-tight text-white sm:text-3xl lg:text-4xl">
                {number.value}
              </span>
              <span className="mt-2 block text-sm text-white/60">
                {number.label}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
