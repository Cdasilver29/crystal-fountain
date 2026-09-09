import { config } from "dotenv";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * One time backfill of campaign_daily_stats.
 *
 * A script rather than a migration on purpose. A migration describes the shape
 * of the database and should produce the same result on every branch it is run
 * against; this reads whatever pledges and payments happen to exist and derives
 * rows from them, so running it on a fresh branch and on production would write
 * different things. That is not a migration, it is an operation.
 *
 * Safe to run more than once. Every row is an upsert keyed on
 * (campaign_id, stat_date), so a second run corrects the first rather than
 * doubling it.
 *
 * What it writes is a reconstruction, not a recording. There is no history of
 * status changes in this schema, so each past day is built from the pledges as
 * they stand now, attributed to the dates they were created and paid. Days from
 * here on are recorded properly by the daily job.
 *
 * Usage: pnpm db:backfill:snapshots
 */

const CAMPAIGN_SLUG = "crystal-fountain";

function heading(text: string) {
  console.log(`\n== ${text} ==`);
}

function show(rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    console.log("(0 rows)");
    return;
  }
  console.table(
    rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([k, v]) => [k, v === null ? null : String(v)]),
      ),
    ),
  );
}

async function main() {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const snapshots = await import("@/server/services/snapshots");
  const campaign = await import("@/server/services/campaign");

  heading("before");
  show(
    (
      await db.execute(sql`
        select count(*) as rows,
               min(stat_date) as earliest,
               max(stat_date) as latest
        from campaign_daily_stats
      `)
    ).rows as Record<string, unknown>[],
  );

  heading("backfilling");
  const result = await snapshots.backfill(db, { campaignSlug: CAMPAIGN_SLUG });

  if (result.from === null) {
    console.log(
      "  This campaign has no verified pledges and no received payments yet,\n" +
        "  so there is nothing to derive a history from. Nothing was written.",
    );
  } else {
    console.log(`  ${result.from} to ${result.to}, ${result.daysWritten} days written`);
  }

  heading("after");
  show(
    (
      await db.execute(sql`
        select count(*) as rows,
               min(stat_date) as earliest,
               max(stat_date) as latest
        from campaign_daily_stats
      `)
    ).rows as Record<string, unknown>[],
  );

  heading("the last seven days");
  show(
    (
      await db.execute(sql`
        select stat_date, pledged_minor, received_minor, pledge_count,
               new_pledges, new_pledged_minor
        from campaign_daily_stats
        order by stat_date desc
        limit 7
      `)
    ).rows as Record<string, unknown>[],
  );

  /*
   * The one figure that has to agree exactly. Today's row is not a
   * reconstruction of anything, it is the campaign as it stands, so it must
   * match the view the rest of the site reads.
   */
  heading("today's row against v_campaign_totals");
  const totals = await campaign.getTotals(db, { campaignSlug: CAMPAIGN_SLUG });
  const todayRow = (
    await db.execute(sql`
      select pledged_minor, received_minor, pledge_count
      from campaign_daily_stats
      where stat_date = ${snapshots.today()}::date
    `)
  ).rows[0] as
    | { pledged_minor: string; received_minor: string; pledge_count: string }
    | undefined;

  show([
    {
      source: "v_campaign_totals",
      pledged: totals.pledgedMinor,
      received: totals.receivedMinor,
      pledges: totals.pledgeCount,
    },
    {
      source: "today's snapshot",
      pledged: todayRow?.pledged_minor ?? "(no row)",
      received: todayRow?.received_minor ?? "(no row)",
      pledges: todayRow?.pledge_count ?? "(no row)",
    },
  ]);

  const agrees =
    todayRow !== undefined &&
    BigInt(todayRow.pledged_minor) === totals.pledgedMinor &&
    BigInt(todayRow.received_minor) === totals.receivedMinor &&
    Number(todayRow.pledge_count) === totals.pledgeCount;

  if (result.from !== null && !agrees) {
    console.error(
      "\nToday's snapshot does not match v_campaign_totals. The backfill is wrong.",
    );
    process.exit(1);
  }

  console.log("\ndone");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
