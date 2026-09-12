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
 * The card WhatsApp draws for this particular pledge.
 *
 * Static metadata before, because nothing on the page's title depended on which
 * pledge it was. The og:image does, so this reads the token. It is only the
 * token: no lookup happens here, because the image route does its own and a
 * page that is about to fetch the pledge anyway should not fetch it twice.
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
  const parsed = publicTokenInput.safeParse({ publicToken: token });

  return pageMetadata({
    title: "Pledge acknowledgement",
    path: "/",
    noIndex: true,
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
    />
  );
}
