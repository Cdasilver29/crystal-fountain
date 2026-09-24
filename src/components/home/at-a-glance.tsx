import { AT_A_GLANCE } from "@/content/project";

/**
 * Three figures and nothing else: a breath between the commitment levels and
 * the timeline, both of them dense.
 *
 * No heading and no band, on purpose. The figures are large and the labels
 * very small with no size in between, and the section stays under 320px tall
 * on a desktop. If it needs to say more, it belongs somewhere else.
 */
export function AtAGlance() {
  return (
    <section
      aria-label="The building at a glance"
      className="page-gutter py-16 sm:py-20 lg:py-24"
    >
      <dl
        data-reveal=""
        data-stagger=""
        className="container-marketing grid grid-cols-3 gap-4 text-center sm:gap-8"
      >
        {AT_A_GLANCE.map(({ figure, label }) => (
          <div key={label} className="flex flex-col-reverse">
            <dt className="mt-2 text-xs text-neutral-500">{label}</dt>
            <dd className="tabular text-[1.75rem] leading-none font-semibold tracking-tight text-navy sm:text-4xl lg:text-[2.75rem]">
              {figure}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
