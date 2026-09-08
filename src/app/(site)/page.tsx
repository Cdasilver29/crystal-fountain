import type { Metadata } from "next";
import Link from "next/link";

import { LiveTracker } from "@/components/campaign/live-tracker";
import { PaymentInstructions } from "@/components/campaign/payment-instructions";
import {
  CAMPAIGN,
  CONTACT,
  PROJECT_SUMMARY,
  SCRIPTURE,
  projectStats,
} from "@/content/campaign";
import { getCampaignTotals } from "@/lib/campaign";
import { pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata({
  title: CAMPAIGN.name,
  path: "/",
});

export default async function HomePage() {
  // Read on the server so the first paint carries real numbers and the page is
  // correct with JavaScript disabled. LiveTracker takes over after hydration.
  const totals = await getCampaignTotals();
  const stats = projectStats(new Date().getFullYear());

  return (
    <>
      <section className="bg-navy px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto w-full max-w-5xl">
          <h1 className="text-3xl font-semibold tracking-tight text-balance text-white sm:text-5xl">
            {CAMPAIGN.name}
          </h1>
          <p className="mt-3 text-lg text-balance text-campfire sm:text-xl">
            {CAMPAIGN.subheading}
          </p>

          <div className="mt-10">
            <LiveTracker initial={totals} />
          </div>

          <div className="mt-9">
            <Link
              href="/pledge"
              className="inline-flex h-12 items-center justify-center rounded-xl bg-campfire px-7 text-base font-semibold text-white transition-colors hover:bg-campfire/90 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-navy focus-visible:outline-none"
            >
              Make a pledge
            </Link>
          </div>

          <blockquote className="mt-8 max-w-2xl">
            <p className="text-sm leading-relaxed text-balance text-white/80 italic sm:text-base">
              {SCRIPTURE.text}
            </p>
            <cite className="mt-1.5 block text-sm text-white/60 not-italic">
              {SCRIPTURE.reference}
            </cite>
          </blockquote>
        </div>
      </section>

      <section id="about" className="scroll-mt-16 bg-white px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto w-full max-w-5xl">
          <h2 className="text-2xl font-semibold tracking-tight text-navy sm:text-3xl">
            What is being built
          </h2>

          <p className="mt-4 max-w-3xl text-base leading-relaxed text-neutral-700">
            {PROJECT_SUMMARY}
          </p>

          <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.label}>
                <dt className="sr-only">{stat.label}</dt>
                <dd>
                  <span className="tabular block text-2xl font-semibold tracking-tight text-navy sm:text-3xl">
                    {stat.value}
                  </span>
                  <span className="mt-1 block text-sm text-neutral-600">
                    {stat.label}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="bg-neutral-50 px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto w-full max-w-5xl">
          <h2 className="text-2xl font-semibold tracking-tight text-navy sm:text-3xl">
            How to give
          </h2>
          <p className="mt-3 max-w-3xl text-base leading-relaxed text-neutral-700">
            You can give directly by M-Pesa or bank transfer, whether or not you
            have recorded a pledge.
          </p>

          <div className="mt-8">
            <PaymentInstructions />
          </div>

          <p className="mt-8 text-base text-neutral-700">
            Want to record your pledge?{" "}
            <Link
              href="/pledge"
              className="font-semibold text-campfire underline underline-offset-4"
            >
              Make a pledge &rarr;
            </Link>
          </p>
        </div>
      </section>

      <section className="bg-white px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto w-full max-w-5xl">
          <h2 className="text-2xl font-semibold tracking-tight text-navy sm:text-3xl">
            Contact
          </h2>

          <dl className="mt-6 grid gap-6 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-neutral-500">
                {CONTACT.leaderRole}
              </dt>
              <dd className="mt-1 text-base font-medium text-navy">
                {CONTACT.leaderName}
              </dd>
              <dd className="mt-1">
                <a
                  href={CONTACT.phoneHref}
                  className="tabular text-base text-denim underline underline-offset-4"
                >
                  {CONTACT.phoneDisplay}
                </a>
              </dd>
            </div>

            <div>
              <dt className="text-sm text-neutral-500">{CONTACT.churchName}</dt>
              <dd className="mt-1 text-base text-neutral-700">
                {CONTACT.address}
              </dd>
              <dd className="mt-1">
                <a
                  href={CONTACT.siteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-base text-denim underline underline-offset-4"
                >
                  {CONTACT.siteLabel}
                </a>
              </dd>
            </div>
          </dl>
        </div>
      </section>
    </>
  );
}
