import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PledgeConfirmation } from "@/components/pledge/pledge-confirmation";
import { db } from "@/db";
import { env } from "@/env";
import { getCampaignTotals } from "@/lib/campaign";
import { pageMetadata } from "@/lib/metadata";
import { publicTokenInput } from "@/server/contracts/pledges";
import * as pledges from "@/server/services/pledges";

export const metadata: Metadata = pageMetadata({
  title: "Pledge acknowledgement",
  path: "/",
  noIndex: true,
});

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

  const [pledge, totals] = await Promise.all([
    pledges.getByPublicToken(db, { publicToken: parsed.data.publicToken }),
    getCampaignTotals(),
  ]);

  if (!pledge) notFound();

  return (
    <PledgeConfirmation
      pledge={pledge}
      totals={totals}
      token={parsed.data.publicToken}
      siteUrl={env.NEXT_PUBLIC_SITE_URL}
    />
  );
}
