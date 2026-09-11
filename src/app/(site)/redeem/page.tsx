import type { Metadata } from "next";
import Link from "next/link";

import { RedeemLookup } from "@/components/pledge/redeem-lookup";
import { pageMetadata } from "@/lib/metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "Redeem your pledge",
  description:
    "Look up your pledge to the Crystal Fountain Development Project and see how to pay it.",
  path: "/redeem",
});

/**
 * Where a member goes to pay what they promised.
 *
 * Two things, in the order somebody actually needs them: find the pledge, then
 * pay it. The paying half works for everybody, including a member who never
 * recorded a pledge and simply wants to give, so it is not hidden behind the
 * lookup.
 *
 * The page carries the promise-not-a-payment line as well, because somebody
 * arriving here has already pledged and the distinction is exactly the one they
 * are here to act on.
 */
export default function RedeemPage() {
  return (
    <div className="flex flex-1 flex-col bg-neutral-50">
      <header className="bg-navy px-4 pt-8 pb-10 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <Link
            href="/"
            className="rounded text-sm text-white/70 underline-offset-4 hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
          >
            Crystal Fountain Development Project
          </Link>

          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Redeem your pledge
          </h1>

          <p className="mt-3 max-w-2xl text-base leading-relaxed text-white/80">
            A pledge is a promise to give. This is where you turn it into a
            payment, and where you can check what is still outstanding.
          </p>
        </div>
      </header>

      <main className="px-4 py-10 pb-16 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <RedeemLookup />

          <p className="mt-10 text-center text-sm leading-relaxed text-neutral-600">
            The church treasurer&rsquo;s official receipt is the only valid
            receipt for your contribution.
          </p>
        </div>
      </main>
    </div>
  );
}
