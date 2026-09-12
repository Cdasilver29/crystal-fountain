import type { Metadata } from "next";
import Link from "next/link";

import { CampaignProgress } from "@/components/campaign/campaign-progress";
import {
  PledgeForm,
  type ExistingPledge,
} from "@/components/pledge/pledge-form";
import { JsonLd } from "@/components/seo/json-ld";
import { db } from "@/db";
import { env } from "@/env";
import { getCampaignTotals } from "@/lib/campaign";
import { pageMetadata } from "@/lib/metadata";
import { donateActionSchema } from "@/lib/structured-data";
import { publicTokenInput } from "@/server/contracts/pledges";
import * as pledges from "@/server/services/pledges";

/**
 * The pledge behind an "increase my pledge" link, or null.
 *
 * Only what the form needs to greet somebody: what they already pledged and the
 * reference it sits on. The service's public view is the same one /p/<token>
 * uses, so no phone number and no email address can come back through here.
 *
 * A malformed or unknown token is simply nobody, not an error. Somebody who
 * mangles the link should still get a working form rather than a 404.
 */
async function existingPledgeFor(
  token: string,
): Promise<ExistingPledge | null> {
  const parsed = publicTokenInput.safeParse({ publicToken: token });

  if (!parsed.success) return null;

  const pledge = await pledges.getByPublicToken(db, {
    publicToken: parsed.data.publicToken,
  });

  // A cancelled or fulfilled pledge does not accumulate, so promising somebody
  // their amount will be added to it would be a lie. See ACCUMULATING_STATUSES.
  if (!pledge) return null;
  if (pledge.status !== "pending" && pledge.status !== "verified") return null;

  return {
    reference: pledge.reference,
    amountMinor: pledge.amountMinor.toString(),
  };
}

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "Make a pledge",
  description:
    "Record your pledge toward the Crystal Fountain Development Project at Newlife SDA Church, Nairobi.",
  path: "/pledge",
});

export default async function PledgePage({
  searchParams,
}: {
  searchParams: Promise<{ add?: string }>;
}) {
  const query = await searchParams;
  const totals = await getCampaignTotals();

  /*
   * Somebody arriving from the "increase my pledge" link on their own
   * confirmation page, identified by the same unguessable token that opens it.
   *
   * Deliberately keyed on the token rather than on a phone number. A form that
   * looked a pledge up from a typed phone number would answer "does this person
   * have a pledge, and for how much" to anyone who knew their number, and the
   * congregation's numbers are not secret. The token is already the public
   * identifier for this pledge, so this reveals nothing to whoever is holding
   * the link that /p/<token> would not already show them.
   */
  const returning = query.add
    ? await existingPledgeFor(query.add)
    : null;

  return (
    <div className="flex flex-1 flex-col bg-neutral-50">
      {/* The description on this one is careful: a pledge is a promise to
          give, not a payment, and a rich result must not imply a checkout. */}
      <JsonLd data={donateActionSchema()} />

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
          The form is a client component driven entirely by fetch, and the
          Turnstile widget in front of it needs a script of its own, so with
          JavaScript switched off there is nothing here that can be submitted.
          Without this block the page still renders inputs and buttons and
          simply does nothing when they are used, which reads as a broken site
          rather than a browser setting. Anybody in that position gets the two
          ways to pledge that do not need a browser at all.
        */}
        <noscript>
          <div className="mx-auto mb-6 max-w-lg rounded-2xl border border-campfire/30 bg-campfire/5 px-4 py-4 text-sm leading-relaxed text-neutral-800">
            This pledge form requires JavaScript to work. Please enable
            JavaScript in your browser, or contact the church office at{" "}
            <a
              href="mailto:churchdevelopment@newlifesdanairobi.org"
              className="font-medium underline underline-offset-4"
            >
              churchdevelopment@newlifesdanairobi.org
            </a>{" "}
            or Dr. Steve Mogere at{" "}
            <a
              href="tel:+254722619788"
              className="font-medium underline underline-offset-4"
            >
              0722619788
            </a>{" "}
            to record your pledge.
          </div>
        </noscript>

        {/*
          The site key is not secret and is meant to be rendered. Reading it
          here rather than from a NEXT_PUBLIC_ variable keeps the name the one
          Cloudflare prints on its dashboard, and an empty value simply means
          the form renders no widget, which is what a local machine wants.
        */}
        <PledgeForm
          turnstileSiteKey={env.TURNSTILE_SITE_KEY || null}
          existing={returning}
        />

        <p className="mx-auto mt-6 max-w-lg text-center text-sm leading-relaxed text-neutral-600">
          A pledge is a promise to give, not a payment. You will receive a
          reference number to use when you pay.
        </p>
      </main>
    </div>
  );
}
