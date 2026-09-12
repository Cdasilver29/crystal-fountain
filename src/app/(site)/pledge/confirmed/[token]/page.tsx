import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PledgeConfirmation } from "@/components/pledge/pledge-confirmation";
import { db } from "@/db";
import { env } from "@/env";
import { getCampaignTotals } from "@/lib/campaign";
import { pageMetadata } from "@/lib/metadata";
import { paymentDetails } from "@/lib/payment-details";
import { publicTokenInput } from "@/server/contracts/pledges";
import * as pledges from "@/server/services/pledges";

export const dynamic = "force-dynamic";

/**
 * The tab title follows the heading.
 *
 * An addition is not a new pledge, and a browser tab still reading "recorded"
 * while the page says "updated" is the same confusion in miniature. The token
 * is deliberately not read here: the title says nothing about which pledge this
 * is, so there is nothing to look up.
 */
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ updated?: string }>;
}): Promise<Metadata> {
  const [{ token }, { updated }] = await Promise.all([params, searchParams]);
  const parsed = publicTokenInput.safeParse({ publicToken: token });

  return pageMetadata({
    title: updated === "1" ? "Your pledge is updated" : "Your pledge is recorded",
    path: "/pledge",
    // A pledge acknowledgement is not something to index, even behind an
    // unguessable token.
    noIndex: true,
    // The same card as /p/<token>. This page and that one are the same pledge,
    // so somebody sharing straight from the confirmation and somebody sharing
    // the QR destination later put the identical image in the group.
    image: parsed.success
      ? {
          path: `/api/pledges/${parsed.data.publicToken}/card.png`,
          width: 1200,
          height: 630,
          alt: "Crystal Fountain Development Project pledge card, showing the pledge reference and the campaign's progress toward its goal",
        }
      : undefined,
  });
}

export default async function PledgeConfirmedPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ updated?: string }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const parsed = publicTokenInput.safeParse({ publicToken: token });

  if (!parsed.success) notFound();

  const [pledge, totals, details] = await Promise.all([
    pledges.getByPublicToken(db, { publicToken: parsed.data.publicToken }),
    getCampaignTotals(),
    paymentDetails(),
  ]);

  if (!pledge) notFound();

  return (
    <PledgeConfirmation
      pledge={pledge}
      totals={totals}
      token={parsed.data.publicToken}
      siteUrl={env.NEXT_PUBLIC_SITE_URL}
      details={details}
      justCreated
      /*
       * A flag and nothing more. The amount it changes the wording of is read
       * from the database below, not carried in the URL, because CLAUDE.md
       * keeps personal detail out of query strings and a pledge amount is
       * exactly that.
       */
      isAddition={query.updated === "1"}
    />
  );
}
