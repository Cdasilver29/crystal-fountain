import type { Metadata } from "next";
import Link from "next/link";

import { CampaignProgress } from "@/components/campaign/campaign-progress";
import { PledgeForm } from "@/components/pledge/pledge-form";
import { env } from "@/env";
import { getCampaignTotals } from "@/lib/campaign";
import { pageMetadata } from "@/lib/metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "Make a pledge",
  description:
    "Record your pledge toward the Crystal Fountain Development Project at Newlife SDA Church, Nairobi.",
  path: "/pledge",
});

export default async function PledgePage() {
  const totals = await getCampaignTotals();

  return (
    <div className="flex flex-1 flex-col bg-neutral-50">
      <header className="bg-navy px-4 pt-8 pb-10 sm:px-6">
        <div className="mx-auto w-full max-w-lg">
          <Link
            href="/"
            className="rounded text-sm text-white/70 underline-offset-4 hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
          >
            Crystal Fountain Development Project
          </Link>

          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Make a pledge
          </h1>

          <div className="mt-6">
            <CampaignProgress totals={totals} compact />
          </div>
        </div>
      </header>

      <main className="px-4 py-8 pb-16 sm:px-6">
        {/*
          The site key is not secret and is meant to be rendered. Reading it
          here rather than from a NEXT_PUBLIC_ variable keeps the name the one
          Cloudflare prints on its dashboard, and an empty value simply means
          the form renders no widget, which is what a local machine wants.
        */}
        <PledgeForm turnstileSiteKey={env.TURNSTILE_SITE_KEY || null} />

        <p className="mx-auto mt-6 max-w-lg text-center text-sm leading-relaxed text-neutral-600">
          A pledge is a promise to give, not a payment. You will receive a
          reference number to use when you pay.
        </p>
      </main>
    </div>
  );
}
