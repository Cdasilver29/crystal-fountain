import { config } from "dotenv";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";

import { campaigns } from "./schema";

// Runs outside Next, so load .env.local the same way drizzle.config.ts does.
config({ path: ".env.local" });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
  );
}

/**
 * The one campaign. KES 550,000,000 target, held in minor units.
 * 550_000_000 * 100 = 55_000_000_000.
 */
const CRYSTAL_FOUNTAIN = {
  slug: "crystal-fountain",
  name: "Crystal Fountain Development Project",
  targetMinor: 55_000_000_000n,
  currency: "KES",
  openingBalanceMinor: 0n,
  startsOn: "2025-07-05",
  isPublic: true,
} as const;

async function main() {
  const db = drizzle(neon(databaseUrl!));

  // Idempotent. Running the seed twice must not create a second campaign and
  // must not silently change a target that is already live.
  const existing = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.slug, CRYSTAL_FOUNTAIN.slug));

  if (existing.length > 0) {
    const campaign = existing[0];
    console.log("Campaign already seeded, leaving it untouched.");
    console.table([
      {
        slug: campaign.slug,
        target_minor: campaign.targetMinor.toString(),
        opening_balance_minor: campaign.openingBalanceMinor.toString(),
        starts_on: campaign.startsOn,
        is_public: campaign.isPublic,
      },
    ]);
    return;
  }

  const [inserted] = await db
    .insert(campaigns)
    .values(CRYSTAL_FOUNTAIN)
    .returning();

  console.log("Seeded campaign.");
  console.table([
    {
      slug: inserted.slug,
      target_minor: inserted.targetMinor.toString(),
      opening_balance_minor: inserted.openingBalanceMinor.toString(),
      starts_on: inserted.startsOn,
      is_public: inserted.isPublic,
    },
  ]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
