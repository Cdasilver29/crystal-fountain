import Link from "next/link";

import { MPESA } from "@/content/campaign";

/**
 * The closing band.
 *
 * Campfire fills the width here, the one place on the page it does, and the
 * button inverts to white so the action still reads as the action.
 */
export function FinalCta() {
  return (
    <section className="bg-campfire px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center text-center">
        <h2 className="text-2xl font-semibold tracking-tight text-balance text-white sm:text-4xl">
          Ready to make your pledge?
        </h2>

        <Link
          href="/pledge"
          className="mt-8 inline-flex h-14 items-center justify-center rounded-xl bg-white px-10 text-lg font-semibold text-campfire transition-colors hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-campfire focus-visible:outline-none"
        >
          Make a pledge
        </Link>

        <p className="mt-5 text-sm text-white/90">
          or give directly via M-Pesa Paybill{" "}
          <span className="tabular font-semibold">{MPESA.paybill}</span>
        </p>
      </div>
    </section>
  );
}
