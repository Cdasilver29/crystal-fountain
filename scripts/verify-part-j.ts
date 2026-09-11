import { config } from "dotenv";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Daily snapshot and metrics verification.
 *
 * Builds a spread of pledges and payments across known dates, backfills, and
 * checks the snapshot rows against the ledger they were derived from. Then
 * checks the derived metrics arithmetic, and that the cron endpoint refuses an
 * unauthenticated caller.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:snapshots
 *
 * Everything it creates is removed at the end, apart from audit_log rows, which
 * are append only by design. The snapshot rows it writes are recomputed by a
 * final backfill, so the table is left describing the real campaign.
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const CAMPAIGN_SLUG = "crystal-fountain";
const TEST_PHONE_PREFIX = "+2547999";

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

/** A date N days before today, in Nairobi, as YYYY-MM-DD. */
function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });
}

async function main() {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const snapshots = await import("@/server/services/snapshots");
  const metrics = await import("@/server/services/metrics");
  const campaign = await import("@/server/services/campaign");
  const pledgeSvc = await import("@/server/services/pledges");
  const { createPledgeInput } = await import("@/server/contracts/pledges");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  };

  const sweep = async () => {
    const phones = `${TEST_PHONE_PREFIX}%`;
    await db.execute(sql`
      delete from payment_allocations where pledge_id in (
        select id from pledges where pledger_id in (
          select id from pledgers where phone_e164 like ${phones}))
    `);
    await db.execute(sql`
      delete from payments where external_ref like ${"VERIFYJ%"}
    `);
    await db.execute(sql`
      delete from pledges where pledger_id in (
        select id from pledgers where phone_e164 like ${phones})
    `);
    await db.execute(sql`delete from pledgers where phone_e164 like ${phones}`);
  };

  await sweep();

  const [{ id: campaignId, opening_balance_minor: openingRaw }] = (
    await db.execute(sql`
      select id, opening_balance_minor from campaigns where slug = ${CAMPAIGN_SLUG}
    `)
  ).rows as { id: string; opening_balance_minor: string }[];
  const opening = BigInt(openingRaw);

  /**
   * One day's snapshot row, or undefined when that day has none.
   *
   * Declared before the baseline is taken because the baseline needs it too.
   */
  const rowOn = async (date: string) => {
    const r = await db.execute(sql`
      select pledged_minor, received_minor, pledge_count, pledger_count,
             new_pledges, new_pledged_minor
      from campaign_daily_stats
      where campaign_id = ${campaignId} and stat_date = ${date}::date
    `);
    return r.rows[0] as
      | {
          pledged_minor: string;
          received_minor: string;
          pledge_count: string;
          pledger_count: string;
          new_pledges: string;
          new_pledged_minor: string;
        }
      | undefined;
  };

  /*
   * The campaign as it already stands, before this suite seeds anything.
   *
   * Every figure below is asserted as a delta from this. The earlier version
   * compared against absolutes built out of the opening balance, on the
   * assumption that the only pledges in the campaign were the four this suite
   * makes. That held on a database nobody had used and nowhere else: a single
   * real pledge older than five days puts a figure into every historical
   * snapshot these checks read, and the suite then fails for ever without
   * anything being wrong with the product.
   *
   * Backfilled first so the day rows exist to be read. backfill rewrites each
   * day from pledge history rather than appending, so running it twice is the
   * same as running it once.
   */
  await snapshots.backfill(db, { campaignSlug: CAMPAIGN_SLUG });

  const DAYS = [61, 60, 31, 30, 5] as const;
  const baselineDays = new Map<number, Awaited<ReturnType<typeof rowOn>>>();
  for (const d of DAYS) baselineDays.set(d, await rowOn(daysAgo(d)));

  /** A day's baseline figure, treating a missing row as zero. */
  const was = (d: number, field: "pledged_minor" | "new_pledged_minor") =>
    BigInt(baselineDays.get(d)?.[field] ?? "0");
  const wasCount = (d: number, field: "new_pledges" | "pledger_count") =>
    Number(baselineDays.get(d)?.[field] ?? 0);

  const [baselineShape] = (
    await db.execute(sql`
      select coalesce(sum(p.amount_minor), 0) as total, count(*) as n
      from pledges p
      where p.campaign_id = ${campaignId}
        and p.status in ('verified', 'fulfilled')
        and p.deleted_at is null
    `)
  ).rows as { total: string; n: string }[];
  const baselinePledged = BigInt(baselineShape.total);
  const baselinePledges = Number(baselineShape.n);

  // The same 28 day window metrics.keyMetrics uses for the four week run rate.
  const [baselineWindow] = (
    await db.execute(sql`
      select coalesce(sum(new_pledged_minor), 0) as total
      from campaign_daily_stats
      where campaign_id = ${campaignId}
        and stat_date > current_date - 28
    `)
  ).rows as { total: string }[];
  const baselineWindow28 = BigInt(baselineWindow.total);

  console.log(
    `\nbaseline: ${baselinePledges} live pledge(s) totalling ${baselinePledged} minor, ` +
      `${baselineWindow28} minor in the trailing 28 days.\n` +
      "every figure below is a delta from this.",
  );

  // 1. Pledges on three known days
  heading("1. pledges backdated to three known days");
  const make = async (phone: string, amountKes: number, createdDaysAgo: number) => {
    const created = await pledgeSvc.create(db, {
      input: createPledgeInput.parse({
        fullName: `Snapshot Person ${phone.slice(-4)}`,
        phone,
        amountKes,
        intent: "one_off",
        recordConsent: true,
        contactConsent: false,
        displayConsent: false,
      }),
      campaignSlug: CAMPAIGN_SLUG,
    });
    await pledgeSvc.approve(db, { pledgeId: created.pledgeId, adminId: null });
    // Backdate the row itself, so the snapshot has real dated history to read.
    await db.execute(sql`
      update pledges
      set created_at = (now() at time zone 'utc') - ${createdDaysAgo}::int * interval '1 day'
      where id = ${created.pledgeId}
    `);
    return created;
  };

  const p60 = await make("0799940404", 10_000, 60);
  const p30a = await make("0799941414", 20_000, 30);
  const p30b = await make("0799942424", 30_000, 30);
  const p5 = await make("0799943434", 40_000, 5);

  show([
    { pledge: p60.reference, kes: 10_000, created: daysAgo(60) },
    { pledge: p30a.reference, kes: 20_000, created: daysAgo(30) },
    { pledge: p30b.reference, kes: 30_000, created: daysAgo(30) },
    { pledge: p5.reference, kes: 40_000, created: daysAgo(5) },
  ]);

  // 2. Backfill
  heading("2. backfill");
  const result = await snapshots.backfill(db, { campaignSlug: CAMPAIGN_SLUG });
  console.log(`  ${result.from} to ${result.to}, ${result.daysWritten} days`);
  check("the backfill wrote a run of days", result.daysWritten >= 60);
  check("it starts no later than the oldest pledge", (result.from ?? "") <= daysAgo(60));
  check("it ends today", result.to === snapshots.today());

  // 3. The cumulative figures step on the right days
  heading("3. the series steps where the pledges landed");
  const before = await rowOn(daysAgo(61));
  const on60 = await rowOn(daysAgo(60));
  const on31 = await rowOn(daysAgo(31));
  const on30 = await rowOn(daysAgo(30));
  const on5 = await rowOn(daysAgo(5));

  show([
    { date: daysAgo(61), pledged: before?.pledged_minor, new: before?.new_pledged_minor },
    { date: daysAgo(60), pledged: on60?.pledged_minor, new: on60?.new_pledged_minor },
    { date: daysAgo(31), pledged: on31?.pledged_minor, new: on31?.new_pledged_minor },
    { date: daysAgo(30), pledged: on30?.pledged_minor, new: on30?.new_pledged_minor },
    { date: daysAgo(5), pledged: on5?.pledged_minor, new: on5?.new_pledged_minor },
  ]);

  check(
    "the day the first pledge landed carries it",
    BigInt(on60?.pledged_minor ?? "0") - was(60, "pledged_minor") === 1_000_000n,
  );
  check(
    "and reports it as new that day",
    BigInt(on60?.new_pledged_minor ?? "0") - was(60, "new_pledged_minor") ===
      1_000_000n,
  );
  check(
    "a quiet day holds the running total and reports nothing new",
    BigInt(on31?.pledged_minor ?? "0") - was(31, "pledged_minor") ===
      1_000_000n &&
      BigInt(on31?.new_pledged_minor ?? "-1") -
        was(31, "new_pledged_minor") ===
        0n,
  );
  check(
    "two pledges on one day are both counted",
    BigInt(on30?.new_pledged_minor ?? "0") - was(30, "new_pledged_minor") ===
      5_000_000n &&
      Number(on30?.new_pledges ?? 0) - wasCount(30, "new_pledges") === 2,
  );
  check(
    "the cumulative figure carries all three by then",
    BigInt(on30?.pledged_minor ?? "0") - was(30, "pledged_minor") ===
      6_000_000n,
  );
  check(
    "and all four by the most recent one",
    BigInt(on5?.pledged_minor ?? "0") - was(5, "pledged_minor") ===
      10_000_000n,
  );
  check(
    "pledger_count is distinct people",
    Number(on5?.pledger_count ?? 0) - wasCount(5, "pledger_count") === 4,
  );

  // 4. Today's row must agree with the view the rest of the site reads
  heading("4. today's row against v_campaign_totals");
  const totals = await campaign.getTotals(db, { campaignSlug: CAMPAIGN_SLUG });
  const todayRow = await rowOn(snapshots.today());
  show([
    {
      source: "v_campaign_totals",
      pledged: totals.pledgedMinor,
      received: totals.receivedMinor,
      pledges: totals.pledgeCount,
    },
    {
      source: "snapshot",
      pledged: todayRow?.pledged_minor,
      received: todayRow?.received_minor,
      pledges: todayRow?.pledge_count,
    },
  ]);
  check(
    "pledged agrees exactly",
    BigInt(todayRow?.pledged_minor ?? "-1") === totals.pledgedMinor,
  );
  check(
    "received agrees exactly",
    BigInt(todayRow?.received_minor ?? "-1") === totals.receivedMinor,
  );
  check(
    "the pledge count agrees exactly",
    Number(todayRow?.pledge_count ?? -1) === totals.pledgeCount,
  );

  // 5. Idempotence
  heading("5. running it again changes nothing");
  const rerun = await snapshots.writeSnapshot(db, {
    campaignSlug: CAMPAIGN_SLUG,
    statDate: snapshots.today(),
  });
  const afterRerun = await rowOn(snapshots.today());
  check(
    "a second write of the same day rewrites rather than doubles",
    BigInt(afterRerun?.pledged_minor ?? "-1") === totals.pledgedMinor,
  );
  check("and returns the same figure", rerun.pledgedMinor === totals.pledgedMinor);

  const [{ n: dayCount }] = (
    await db.execute(sql`
      select count(*)::int as n from campaign_daily_stats where campaign_id = ${campaignId}
    `)
  ).rows as { n: number }[];
  await snapshots.backfill(db, { campaignSlug: CAMPAIGN_SLUG });
  const [{ n: dayCountAfter }] = (
    await db.execute(sql`
      select count(*)::int as n from campaign_daily_stats where campaign_id = ${campaignId}
    `)
  ).rows as { n: number }[];
  check("a second backfill adds no rows", dayCount === dayCountAfter, `${dayCount}`);

  // 6. The read helpers
  heading("6. series and monthly");
  const full = await snapshots.series(db, { campaignSlug: CAMPAIGN_SLUG });
  const last30 = await snapshots.series(db, { campaignSlug: CAMPAIGN_SLUG, days: 30 });
  const byMonth = await snapshots.monthly(db, { campaignSlug: CAMPAIGN_SLUG });
  show(byMonth.map((m) => ({ month: m.month, new_pledged: m.newPledgedMinor, pledges: m.newPledges })));

  check("the series comes back oldest first", full[0].statDate < full[full.length - 1].statDate);
  check("the cumulative figure never falls", full.every((r, i) => i === 0 || r.pledgedMinor >= full[i - 1].pledgedMinor));
  check("a windowed series is capped and still ends today", last30.length <= 30 && last30[last30.length - 1].statDate === snapshots.today());
  check(
    "the monthly totals add up to the campaign's own pledging",
    byMonth.reduce((t, m) => t + m.newPledgedMinor, 0n) === totals.pledgedMinor - opening,
  );

  // 7. The metrics
  heading("7. key metrics");
  const m = await metrics.keyMetrics(db, { campaignSlug: CAMPAIGN_SLUG });
  show([
    {
      average: m.averagePledgeMinor,
      median: m.medianPledgeMinor,
      rate4w: m.runRate4WeekMinor,
      rate12w: m.runRate12WeekMinor,
      weeks: m.weeksToTarget,
      months: m.monthsToTarget,
      requiredMonthly: m.requiredMonthlyMinor,
      monthsRemaining: m.monthsRemaining,
    },
  ]);

  /*
   * Asserted against the pledges that exist, not against the formula the
   * service uses. The earlier version of this check compared the result to
   * pledgedMinor / pledgeCount, which is what the code did, so it passed while
   * the opening balance was being shared out among the pledges and the average
   * read KES 275,000 instead of KES 25,000.
   *
   * The expected figure is built from the baseline plus this suite's own four
   * pledges rather than hardcoded at KES 25,000, so it stays right on a
   * campaign that already holds pledges of its own. The check below it is what
   * actually guards the opening balance bug.
   */
  const seededPledged = 1_000_000n + 2_000_000n + 3_000_000n + 4_000_000n;
  const expectedAverage =
    (baselinePledged + seededPledged) / BigInt(baselinePledges + 4);
  check(
    "the average is the mean of the pledges, not of the campaign total",
    m.averagePledgeMinor === expectedAverage,
    `${m.averagePledgeMinor}, expected ${expectedAverage} from ${baselinePledges + 4} pledges`,
  );
  check(
    "and it ignores the opening balance entirely",
    m.averagePledgeMinor !== null &&
      m.averagePledgeMinor < m.pledgedMinor / BigInt(m.pledgeCount),
  );
  check(
    "the median is a real pledge amount, not an interpolation",
    [1_000_000n, 2_000_000n, 3_000_000n, 4_000_000n].includes(
      m.medianPledgeMinor ?? 0n,
    ),
    String(m.medianPledgeMinor),
  );
  check(
    "the 12 week rate covers the pledging in that window",
    m.runRate12WeekMinor !== null && m.runRate12WeekMinor > 0n,
  );
  /*
   * Of this suite's four pledges only the five day old one falls inside the 28
   * day window, so the window's own total is whatever it already held plus
   * that one. Divided by four, the way the service does it, after the addition
   * rather than before, because integer division twice would lose shillings
   * that the single division does not.
   */
  const expectedRate4w = (baselineWindow28 + 4_000_000n) / 4n;
  check(
    "the 4 week window sees only the recent pledge",
    m.runRate4WeekMinor === expectedRate4w,
    `${m.runRate4WeekMinor}, expected ${expectedRate4w}`,
  );
  check(
    "the estimate divides what is left by the rate",
    m.weeksToTarget ===
      Number(m.remainingMinor / (m.runRate12WeekMinor ?? 1n)),
  );
  check(
    "the required monthly rate divides what is left by the months left",
    m.requiredMonthlyMinor === m.remainingMinor / BigInt(m.monthsRemaining),
  );
  check("months remaining is at least one", m.monthsRemaining >= 1);

  // 8. The cron endpoint refuses a caller with no secret
  heading("8. the cron endpoint");
  const noSecret = await fetch(`${BASE}/api/cron/daily-snapshot`);
  const wrongSecret = await fetch(`${BASE}/api/cron/daily-snapshot`, {
    headers: { authorization: "Bearer not-the-secret" },
  });
  show([{ noSecret: noSecret.status, wrongSecret: wrongSecret.status }]);
  check("an unauthenticated call is refused", noSecret.status === 401);
  check("a wrong secret is refused", wrongSecret.status === 401);

  const configured = Boolean(process.env.CRON_SECRET);
  if (configured) {
    const good = await fetch(`${BASE}/api/cron/daily-snapshot`, {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    const body = await good.json();
    check("the real secret is accepted", good.status === 200, String(good.status));
    check("and it writes today's row", body.statDate === snapshots.today());
  } else {
    console.log(
      "  CRON_SECRET is not set locally, so the accepted path is not exercised here.",
    );
  }

  // 9. Clean up, then leave the table describing the real campaign
  heading("9. cleanup");
  await sweep();
  await db.execute(sql`delete from campaign_daily_stats where campaign_id = ${campaignId}`);
  const rebuilt = await snapshots.backfill(db, { campaignSlug: CAMPAIGN_SLUG });
  console.log(
    `  test rows removed, snapshots rebuilt from real data (${rebuilt.daysWritten} days)`,
  );

  heading("result");
  if (failures.length > 0) {
    console.error(`${failures.length} check(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("all checks passed");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
