import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PledgeConfirmation } from "@/components/pledge/pledge-confirmation";
import { env } from "@/env";
import { getCampaignTotals } from "@/lib/campaign";
import { pageMetadata } from "@/lib/metadata";
import { paymentDetails } from "@/lib/payment-details";
import {
  findPledgeByToken,
  TOKEN_NOT_FOUND_TITLE,
} from "@/lib/pledge-by-token";

export const dynamic = "force-dynamic";

/**
 * The tab title follows the heading.
 *
 * An addition is not a new pledge, and a browser tab still reading "recorded"
 * while the page says "updated" is the same confusion in miniature. The title
 * says nothing about which pledge this is, but it does look the token up, so a
 * token that matches nothing says "Page not found" in the tab as well as on the
 * page. findPledgeByToken is cached for the request, so the page below reuses
 * this lookup rather than making a second one.
 */
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ updated?: string }>;
}): Promise<Metadata> {
  const [{ token }, { updated }] = await Promise.all([params, searchParams]);
  const found = await findPledgeByToken(token);

  if (!found) {
    return pageMetadata({
      title: TOKEN_NOT_FOUND_TITLE,
      path: "/pledge",
      noIndex: true,
    });
  }

  return pageMetadata({
    title: updated === "1" ? "Your pledge is updated" : "Your pledge is recorded",
    path: "/pledge",
    // A pledge acknowledgement is not something to index, even behind an
    // unguessable token.
    noIndex: true,
    // The same card as /p/<token>. This page and that one are the same pledge,
    // so somebody sharing straight from the confirmation and somebody sharing
    // the QR destination later put the identical image in the group.
    image: {
      path: `/api/pledges/${found.publicToken}/card.png`,
      width: 1200,
      height: 630,
      alt: "Crystal Fountain Development Project pledge card, showing the pledge reference and the campaign's progress toward its goal",
    },
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
  // The same lookup the title made, reused rather than repeated.
  const [found, totals, details] = await Promise.all([
    findPledgeByToken(token),
    getCampaignTotals(),
    paymentDetails(),
  ]);

  if (!found) notFound();

  return (
    <PledgeConfirmation
      pledge={found.pledge}
      totals={totals}
      token={found.publicToken}
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
