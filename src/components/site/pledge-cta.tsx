import Link from "next/link";

/**
 * The closing call to action shared by the content pages.
 *
 * A pledge is a promise to give and not a payment, and that has to be legible
 * before someone taps, not only on the confirmation page.
 */
export function PledgeCta({ heading }: { heading: string }) {
  return (
    <section className="bg-navy px-4 py-12 sm:px-6 sm:py-16">
      <div className="mx-auto w-full max-w-5xl">
        <h2 className="text-2xl font-semibold tracking-tight text-balance text-white sm:text-3xl">
          {heading}
        </h2>

        <p className="mt-3 max-w-2xl text-base leading-relaxed text-white/80">
          A pledge is a promise to give, not a payment. You record the amount you
          intend to give and fulfil it over time.
        </p>

        <Link
          href="/pledge"
          className="mt-7 inline-flex h-12 items-center justify-center rounded-xl bg-campfire px-7 text-base font-semibold text-white transition-colors hover:bg-campfire/90 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-navy focus-visible:outline-none"
        >
          Make a pledge
        </Link>
      </div>
    </section>
  );
}
