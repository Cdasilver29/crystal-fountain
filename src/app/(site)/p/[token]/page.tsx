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
import { ownsPledge } from "@/lib/pledge-ownership";

export const dynamic = "force-dynamic";

/**
 * The card WhatsApp draws for this particular pledge.
 *
 * Static metadata before, because nothing on the page's title depended on which
 * pledge it was. The og:image does, so this reads the token, and it looks the
 * pledge up so a token that matches nothing gets "Page not found" in the tab
 * as well as on the page. findPledgeByToken is cached for the request, so the
 * page below reuses this lookup rather than making a second one.
 *
 * Still noIndex. An unguessable token is not a reason to invite a crawler, and
 * og tags are read by link scrapers regardless of robots directives, which is
 * exactly the audience this is for.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const found = await findPledgeByToken(token);

  if (!found) {
    return pageMetadata({
      title: TOKEN_NOT_FOUND_TITLE,
      path: "/",
      noIndex: true,
    });
  }

  return pageMetadata({
    title: "Pledge acknowledgement",
    path: "/",
    noIndex: true,
    image: {
      path: `/api/pledges/${found.publicToken}/card.png`,
      width: 1200,
      height: 630,
      alt: "Crystal Fountain Development Project pledge card, showing a masked pledge reference and the campaign's progress toward its goal",
    },
  });
}

/**
 * The QR destination. Same component as the confirmation page, because a member
 * scanning their own code should land on exactly what they saw when they
 * pledged.
 */
export default async function PublicPledgePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // The same lookup the title made, reused rather than repeated.
  const [found, totals, details] = await Promise.all([
    findPledgeByToken(token),
    getCampaignTotals(),
    paymentDetails(),
  ]);

  if (!found) notFound();

  // Reading the cookie also keeps this page per request: it varies by viewer,
  // so it must never be rendered once and served to everybody.
  const isOwner = await ownsPledge(found.pledge.id);

  return (
    <PledgeConfirmation
      pledge={found.pledge}
      totals={totals}
      token={found.publicToken}
      siteUrl={env.NEXT_PUBLIC_SITE_URL}
      details={details}
      isOwner={isOwner}
    />
  );
}
