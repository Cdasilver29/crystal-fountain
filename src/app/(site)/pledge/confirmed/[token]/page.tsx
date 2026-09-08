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
  title: "Your pledge is recorded",
  path: "/pledge",
  // A pledge acknowledgement is not something to index, even behind an
  // unguessable token.
  noIndex: true,
});

export default async function PledgeConfirmedPage({
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
      justCreated
    />
  );
}
