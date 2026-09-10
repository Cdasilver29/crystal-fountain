import { config } from "dotenv";

import { provisionAdmin, removeVerificationAdmins } from "./verification-admin";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Admin analytics verification.
 *
 * Builds pledges of known ages, channels and balances, then checks every
 * figure on /admin/analytics against the database rather than against the
 * page. The ageing and channel sections are checked as deltas across the
 * fixtures rather than as absolute values, so the script is correct whatever
 * the campaign already holds.
 *
 * Signed in as a viewer throughout, deliberately. Viewer is the weakest of the
 * three roles, so a viewer reading the page and the endpoint proves all three
 * can.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:analytics
 *
 * Everything it creates is removed at the end and the snapshots are rebuilt
 * from the real rows, because the fixtures land in campaign_daily_stats while
 * they exist and the table must be left telling the truth. Audit rows stay,
 * being append only by design.
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const CAMPAIGN_SLUG = "crystal-fountain";
const TEST_PHONE_PREFIX = "+2547998";
const ADMIN_EMAIL = "verify-part-m@example.test";
const ADMIN_PASSWORD = "correct-horse-battery-staple";

/** Strings that survive minification and only exist if recharts is present. */
const RECHARTS_MARKERS = ["recharts", "CartesianGrid"];

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

/** Every /_next chunk a page references, deduplicated. */
function chunksIn(html: string): string[] {
  const found = html.match(/\/_next\/static\/chunks\/[A-Za-z0-9_./-]+\.js/g) ?? [];
  return [...new Set(found)];
}

async function main() {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const analytics = await import("@/server/services/analytics");
  const snapshots = await import("@/server/services/snapshots");
  const pledgeSvc = await import("@/server/services/pledges");
  const paymentSvc = await import("@/server/services/payments");
  const { createPledgeInput } = await import("@/server/contracts/pledges");
  const { recordPaymentInput } = await import("@/server/contracts/payments");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  };

  const sweep = async () => {
    const phones = `${TEST_PHONE_PREFIX}%`;
    await db.execute(sql`
      delete from payment_allocations a
      using pledges p, pledgers g
      where a.pledge_id = p.id and p.pledger_id = g.id
        and g.phone_e164 like ${phones}
    `);
    await db.execute(sql`
      delete from payment_allocations a
      using payments pay
      where a.payment_id = pay.id and pay.external_ref like 'VERIFYM%'
    `);
    // Payments have no pledger, so they are swept by the reference prefix the
    // fixtures stamp on them.
    await db.execute(sql`
      delete from payments where external_ref like 'VERIFYM%'
    `);
    await db.execute(sql`
      delete from pledges p using pledgers g
      where p.pledger_id = g.id and g.phone_e164 like ${phones}
    `);
    await db.execute(sql`delete from pledgers where phone_e164 like ${phones}`);
    await removeVerificationAdmins(db);
  };

  await sweep();

  const slug = { campaignSlug: CAMPAIGN_SLUG };

  // Everything is measured as a change from here, so existing rows do not
  // have to be known or disturbed.
  const before = {
    ageing: await analytics.ageing(db, slug),
    channels: await analytics.channelMix(db, slug),
    fulfilment: await analytics.fulfilment(db, slug),
  };

  heading("0. sign in as a viewer");
  const provisioned = await provisionAdmin(db, {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    fullName: "Verification Viewer",
    role: "viewer",
  });
  const adminId = provisioned.adminUserId;

  const login = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const cookie = login.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
  check("a viewer can sign in", cookie.length > 0);
  const as = { headers: { cookie } };

  /* -----------------------------------------------------------------------
   * 1. Fixtures
   * --------------------------------------------------------------------- */

  heading("1. fixtures");

  const makePledge = async (args: {
    name: string;
    phone: string;
    amountKes: number;
    channel?: "web" | "admin" | "event" | "sms" | "import";
    ageDays?: number;
    approve?: boolean;
  }) => {
    const created = await pledgeSvc.create(db, {
      input: createPledgeInput.parse({
        fullName: args.name,
        phone: args.phone,
        amountKes: args.amountKes,
        intent: "one_off",
        recordConsent: true,
        contactConsent: false,
        displayConsent: false,
      }),
      campaignSlug: CAMPAIGN_SLUG,
      channel: args.channel ?? "web",
    });

    if (args.approve !== false) {
      await pledgeSvc.approve(db, { pledgeId: created.pledgeId, adminId });
    }

    /*
     * Backdated in place. There is no way to create a pledge in the past
     * through the service, and the ageing report is entirely about how old a
     * pledge is, so the only way to test it is to make one old.
     */
    if (args.ageDays) {
      await db.execute(sql`
        update pledges
        set created_at = now() - (${args.ageDays}::int * interval '1 day')
        where id = ${created.pledgeId}
      `);
    }

    return created;
  };

  // One pledge per ageing bucket, each a different amount so a figure landing
  // in the wrong bucket is obvious rather than merely wrong.
  const aged = {
    recent: await makePledge({
      name: "Ageing Recent",
      phone: "0799841111",
      amountKes: 5_000,
      ageDays: 5,
    }),
    quarter: await makePledge({
      name: "Ageing Quarter",
      phone: "0799842222",
      amountKes: 6_000,
      ageDays: 60,
    }),
    half: await makePledge({
      name: "Ageing Half",
      phone: "0799843333",
      amountKes: 7_000,
      ageDays: 120,
    }),
    old: await makePledge({
      name: "Ageing Old",
      phone: "0799844444",
      amountKes: 8_000,
      ageDays: 400,
    }),
  };

  // Two more channels, so the mix has something other than web in it.
  const atEvent = await makePledge({
    name: "Channel Event",
    phone: "0799845555",
    amountKes: 9_000,
    channel: "event",
  });
  const byAdmin = await makePledge({
    name: "Channel Admin",
    phone: "0799846666",
    amountKes: 11_000,
    channel: "admin",
  });

  // A part paid pledge, so the fulfilment rate has a fraction to report and
  // the ageing buckets have a partial balance to carry.
  const payment = await paymentSvc.record(db, {
    input: recordPaymentInput.parse({
      method: "mpesa",
      externalRef: `VERIFYM${Date.now().toString().slice(-6)}`,
      amountKes: 4_000,
      payerName: "Ageing Recent",
      payerPhone: "0799841111",
      accountRef: aged.recent.reference,
      paidAt: new Date().toISOString().slice(0, 10),
      note: "verify-part-m",
    }),
    campaignSlug: CAMPAIGN_SLUG,
    adminId,
  });
  await paymentSvc.allocate(db, {
    paymentId: payment.paymentId,
    input: { pledgeId: aged.recent.pledgeId },
    adminId,
  });

  await snapshots.backfill(db, slug);

  show([
    { pledge: aged.recent.reference, age: "5 days", amount: "5,000, 4,000 paid" },
    { pledge: aged.quarter.reference, age: "60 days", amount: "6,000" },
    { pledge: aged.half.reference, age: "120 days", amount: "7,000" },
    { pledge: aged.old.reference, age: "400 days", amount: "8,000" },
    { pledge: atEvent.reference, age: "today", amount: "9,000 at an event" },
    { pledge: byAdmin.reference, age: "today", amount: "11,000 by an admin" },
  ]);

  /* -----------------------------------------------------------------------
   * 2. Ageing
   * --------------------------------------------------------------------- */

  heading("2. outstanding by age");

  const ageing = await analytics.ageing(db, slug);
  const beforeByKey = new Map(
    before.ageing.buckets.map((b) => [b.key, b.outstandingMinor]),
  );
  const delta = (key: (typeof ageing.buckets)[number]["key"]) => {
    const now = ageing.buckets.find((b) => b.key === key)!.outstandingMinor;
    return now - (beforeByKey.get(key) ?? 0n);
  };

  show(
    ageing.buckets.map((b) => ({
      bucket: b.key,
      pledges: b.pledgeCount,
      outstandingMinor: b.outstandingMinor,
      addedByFixtures: delta(b.key),
    })),
  );

  // The recent pledge is 5,000 with 4,000 allocated, so 1,000 is outstanding.
  // The other three carry their full amounts. Plus the two channel fixtures,
  // both made today, which land in the youngest bucket as well.
  check(
    "0 to 30 days carries the part paid pledge and both channel fixtures",
    delta("0-30") === 100_000n + 900_000n + 1_100_000n,
    String(delta("0-30")),
  );
  check("31 to 90 days carries the 60 day pledge", delta("31-90") === 600_000n);
  check("91 to 180 days carries the 120 day pledge", delta("91-180") === 700_000n);
  check("over 180 days carries the 400 day pledge", delta("180+") === 800_000n);

  const bucketSum = ageing.buckets.reduce(
    (total, b) => total + b.outstandingMinor,
    0n,
  );
  check(
    "the buckets sum to the reported total",
    bucketSum === ageing.totalOutstandingMinor,
    `${bucketSum} of ${ageing.totalOutstandingMinor}`,
  );

  /*
   * The same figure computed a completely different way: straight off the
   * view, with no bucketing in it at all. If the CASE expression ever drops a
   * row into no bucket, this is what catches it.
   */
  const [independent] = (
    await db.execute(sql`
      select coalesce(sum(b.outstanding_minor), 0)::text as total,
             count(*)::int as pledges
      from pledges p
      join v_pledge_balances b on b.pledge_id = p.id
      join campaigns c on c.id = p.campaign_id
      where c.slug = ${CAMPAIGN_SLUG}
        and p.status in ('pending', 'verified', 'fulfilled')
        and b.outstanding_minor > 0
    `)
  ).rows as { total: string; pledges: number }[];

  show([
    {
      bucketed: String(ageing.totalOutstandingMinor),
      straightFromTheView: independent.total,
      pledgesBucketed: ageing.totalPledges,
      pledgesInTheView: independent.pledges,
    },
  ]);
  check(
    "and to the outstanding balance read straight from v_pledge_balances",
    ageing.totalOutstandingMinor === BigInt(independent.total),
  );
  check(
    "with the same pledge count",
    ageing.totalPledges === independent.pledges,
  );

  // A cancelled pledge is a promise that no longer exists. Carrying it in an
  // outstanding column would invent a debt.
  await db.execute(sql`
    update pledges set status = 'cancelled', cancelled_at = now()
    where id = ${aged.old.pledgeId}
  `);
  const afterCancel = await analytics.ageing(db, slug);
  check(
    "a cancelled pledge leaves the buckets",
    afterCancel.totalOutstandingMinor ===
      ageing.totalOutstandingMinor - 800_000n,
    String(afterCancel.totalOutstandingMinor),
  );
  await db.execute(sql`
    update pledges set status = 'verified', cancelled_at = null
    where id = ${aged.old.pledgeId}
  `);

  /* -----------------------------------------------------------------------
   * 3. Channel mix
   * --------------------------------------------------------------------- */

  heading("3. channel mix");

  const channels = await analytics.channelMix(db, slug);
  const beforeChannel = new Map(
    before.channels.map((c) => [c.channel, c] as const),
  );

  show(
    channels.map((c) => ({
      channel: c.channel,
      label: c.label,
      pledges: c.pledgeCount,
      totalMinor: c.totalMinor,
    })),
  );

  check(
    "every channel the schema allows has a row",
    channels.length === 5 &&
      channels.map((c) => c.channel).join(",") ===
        "web,admin,event,sms,import",
    channels.map((c) => c.channel).join(","),
  );

  const web = channels.find((c) => c.channel === "web")!;
  check(
    "web carries the four web fixtures",
    web.pledgeCount - (beforeChannel.get("web")?.pledgeCount ?? 0) === 4,
    `${web.pledgeCount} now`,
  );
  check("and shows real pledges, not an empty row", web.pledgeCount > 0);

  const event = channels.find((c) => c.channel === "event")!;
  check(
    "the event pledge is on the event channel",
    event.totalMinor - (beforeChannel.get("event")?.totalMinor ?? 0n) ===
      900_000n,
  );

  const byAdminRow = channels.find((c) => c.channel === "admin")!;
  check(
    "the admin pledge is on the admin channel",
    byAdminRow.totalMinor - (beforeChannel.get("admin")?.totalMinor ?? 0n) ===
      1_100_000n,
  );

  const sms = channels.find((c) => c.channel === "sms")!;
  check(
    "a channel with nothing on it is still reported, at zero",
    sms.pledgeCount === 0 && sms.totalMinor === 0n,
  );

  /* -----------------------------------------------------------------------
   * 4. Fulfilment rate
   * --------------------------------------------------------------------- */

  heading("4. fulfilment rate");

  const fulfilment = await analytics.fulfilment(db, slug);
  show([
    {
      allocatedMinor: fulfilment.allocatedMinor,
      promisedMinor: fulfilment.promisedMinor,
      ratePercent: fulfilment.ratePercent,
      wasBefore: before.fulfilment.ratePercent,
    },
  ]);

  check(
    "the fixtures added 4,000 of allocation",
    fulfilment.allocatedMinor - before.fulfilment.allocatedMinor === 400_000n,
    String(fulfilment.allocatedMinor),
  );
  check(
    "and 46,000 of approved promises",
    fulfilment.promisedMinor - before.fulfilment.promisedMinor === 4_600_000n,
    String(fulfilment.promisedMinor),
  );
  check(
    "the rate is the one over the other",
    fulfilment.ratePercent !== null &&
      Math.abs(
        fulfilment.ratePercent -
          Number((fulfilment.allocatedMinor * 10_000n) / fulfilment.promisedMinor) /
            100,
      ) < 0.0001,
    String(fulfilment.ratePercent),
  );

  /*
   * A reversed allocation is money taken back off the pledge. Counting it
   * would report a promise as kept when it is not.
   */
  await db.execute(sql`
    update payment_allocations a
    set reversed_at = now()
    from pledges p
    where a.pledge_id = p.id and p.id = ${aged.recent.pledgeId}
  `);
  const reversed = await analytics.fulfilment(db, slug);
  check(
    "a reversed allocation stops counting",
    reversed.allocatedMinor === fulfilment.allocatedMinor - 400_000n,
    String(reversed.allocatedMinor),
  );
  const reversedAgeing = await analytics.ageing(db, slug);
  check(
    "and the amount goes back into the outstanding column",
    reversedAgeing.totalOutstandingMinor ===
      ageing.totalOutstandingMinor + 400_000n,
    String(reversedAgeing.totalOutstandingMinor),
  );
  await db.execute(sql`
    update payment_allocations a
    set reversed_at = null
    from pledges p
    where a.pledge_id = p.id and p.id = ${aged.recent.pledgeId}
  `);

  /* -----------------------------------------------------------------------
   * 5. Weekly trend
   * --------------------------------------------------------------------- */

  heading("5. the trailing twelve weeks");

  const weekly = await analytics.weekly(db, slug);
  show(
    weekly.map((w) => ({
      isoWeek: w.isoWeek,
      weekStart: w.weekStart,
      newPledges: w.newPledges,
      newPledgedMinor: w.newPledgedMinor,
    })),
  );

  check("there are twelve weeks", weekly.length === 12, String(weekly.length));
  check(
    "oldest first",
    weekly[0].weekStart < weekly[weekly.length - 1].weekStart,
  );

  const gaps = weekly
    .slice(1)
    .map(
      (w, i) =>
        (Date.parse(`${w.weekStart}T00:00:00Z`) -
          Date.parse(`${weekly[i].weekStart}T00:00:00Z`)) /
        86_400_000,
    );
  check(
    "and they are twelve consecutive weeks with no gap",
    gaps.every((days) => days === 7),
    gaps.join(","),
  );

  check(
    "every week starts on a Monday",
    weekly.every(
      (w) => new Date(`${w.weekStart}T00:00:00Z`).getUTCDay() === 1,
    ),
  );

  /*
   * Two fixtures were made today, the event one and the admin one. The part
   * paid pledge is five days old and belongs to whichever week that falls in,
   * which is the point of bucketing by the pledge date rather than by when the
   * script happened to run.
   */
  const thisWeek = weekly[weekly.length - 1];
  check(
    "this week counts the two pledges made today",
    thisWeek.newPledges >= 2 && thisWeek.newPledgedMinor >= 2_000_000n,
    `${thisWeek.newPledges} new pledges, ${thisWeek.newPledgedMinor}`,
  );

  // And the five day old one is in a week, not lost between them.
  const fixtureWeeks = weekly.filter((w) => w.newPledges > 0);
  check(
    "the backdated pledge lands in an earlier week rather than nowhere",
    fixtureWeeks.reduce((total, w) => total + w.newPledgedMinor, 0n) >=
      2_000_000n + 500_000n,
    fixtureWeeks.map((w) => `${w.isoWeek}:${w.newPledgedMinor}`).join(" "),
  );

  /* -----------------------------------------------------------------------
   * 6. Projection
   * --------------------------------------------------------------------- */

  heading("6. the projection");

  const target = 55_000_000_000n;
  const straight = analytics.projection({
    from: { date: "2026-01-05", pledgedMinor: 0n },
    weeklyRateMinor: 1_000_000_000n,
    targetMinor: target,
  });

  show([
    {
      points: straight.length,
      firstDate: straight[0]?.date,
      lastDate: straight[straight.length - 1]?.date,
      lastMinor: straight[straight.length - 1]?.pledgedMinor,
    },
  ]);

  check(
    "it starts on the last actual point, so the dashed line joins the solid one",
    straight[0]?.date === "2026-01-05" && straight[0]?.pledgedMinor === 0n,
  );
  check(
    "550M at 10M a week arrives after 55 weeks",
    straight.length - 1 === 385,
    `${straight.length - 1} days`,
  );
  check(
    "it stops on the target rather than climbing past it",
    straight[straight.length - 1].pledgedMinor === target,
  );
  check(
    "no rate at all draws nothing",
    analytics.projection({
      from: { date: "2026-01-05", pledgedMinor: 0n },
      weeklyRateMinor: null,
      targetMinor: target,
    }).length === 0,
  );
  check(
    "a rate of zero draws nothing",
    analytics.projection({
      from: { date: "2026-01-05", pledgedMinor: 0n },
      weeklyRateMinor: 0n,
      targetMinor: target,
    }).length === 0,
  );
  check(
    "a campaign already at its target draws nothing",
    analytics.projection({
      from: { date: "2026-01-05", pledgedMinor: target },
      weeklyRateMinor: 1_000_000_000n,
      targetMinor: target,
    }).length === 0,
  );

  /*
   * A weekly rate of one cent. Six cents a week truncates to zero cents a day,
   * which is what an accumulating daily rate would project for ever.
   */
  const crawling = analytics.projection({
    from: { date: "2026-01-05", pledgedMinor: 0n },
    weeklyRateMinor: 1n,
    targetMinor: target,
  });
  check(
    "a rate under a cent a day still moves, and stops at the cap",
    crawling.length === analytics.MAX_PROJECTION_DAYS + 1 &&
      crawling[crawling.length - 1].pledgedMinor > 0n,
    `${crawling.length} points ending at ${crawling[crawling.length - 1]?.pledgedMinor}`,
  );

  /* -----------------------------------------------------------------------
   * 7. The endpoint
   * --------------------------------------------------------------------- */

  heading("7. GET /api/admin/analytics");

  const apiRes = await fetch(`${BASE}/api/admin/analytics`, as);
  const api = (await apiRes.json()) as {
    currency: string;
    fulfilment: { allocatedMinor: string; promisedMinor: string; ratePercent: number | null };
    ageing: {
      totalOutstandingMinor: string;
      buckets: { key: string; outstandingMinor: string; pledgeCount: number }[];
    };
    channels: { channel: string; pledgeCount: number; totalMinor: string }[];
    weekly: { isoWeek: string; newPledgedMinor: string }[];
  };

  show([
    {
      status: apiRes.status,
      cacheControl: apiRes.headers.get("cache-control"),
      buckets: api.ageing.buckets.length,
      channels: api.channels.length,
      weeks: api.weekly.length,
    },
  ]);

  check("a viewer gets 200", apiRes.status === 200);
  check(
    "cached privately for five minutes, never in a shared proxy",
    (apiRes.headers.get("cache-control") ?? "").includes("private") &&
      (apiRes.headers.get("cache-control") ?? "").includes("max-age=300") &&
      !(apiRes.headers.get("cache-control") ?? "").includes("s-maxage"),
    apiRes.headers.get("cache-control") ?? "none",
  );
  check("amounts cross as minor unit strings", typeof api.fulfilment.allocatedMinor === "string");
  check("with the currency named", api.currency === "KES");

  check(
    "the endpoint agrees with the service on the outstanding total",
    BigInt(api.ageing.totalOutstandingMinor) === ageing.totalOutstandingMinor,
  );
  const apiBucketSum = api.ageing.buckets.reduce(
    (total, b) => total + BigInt(b.outstandingMinor),
    0n,
  );
  check(
    "and its buckets sum to it too",
    apiBucketSum === BigInt(api.ageing.totalOutstandingMinor),
    `${apiBucketSum}`,
  );
  check("it serves all five channels", api.channels.length === 5);
  check("and twelve weeks", api.weekly.length === 12);

  /*
   * Nothing that names anybody. This is behind a session rather than public,
   * but the rule in CLAUDE.md is about what an endpoint returns, and an
   * aggregate endpoint that grows a name column later should fail here.
   */
  const flat = JSON.stringify(api);
  check(
    "no pledge reference, phone or name reaches the response",
    !flat.includes(aged.recent.reference) &&
      !flat.includes("0799841111") &&
      !flat.includes("Ageing Recent"),
  );

  const anon = await fetch(`${BASE}/api/admin/analytics`);
  check("and signing out closes it", anon.status === 401, String(anon.status));

  /* -----------------------------------------------------------------------
   * 8. The page
   * --------------------------------------------------------------------- */

  heading("8. /admin/analytics");

  const pageRes = await fetch(`${BASE}/admin/analytics`, as);
  const page = await pageRes.text();

  check("a viewer gets 200", pageRes.status === 200);

  const sections = [
    ["1 summary", "Where we are"],
    ["2 cumulative", "Pledges over time"],
    ["3 ageing", "Outstanding by age"],
    ["4 channels", "Where pledges come from"],
    ["5 weekly", "The last twelve weeks"],
    ["6 forecast", "What the pace implies"],
  ] as const;
  for (const [label, text] of sections) {
    check(`section ${label} is on the page`, page.includes(text));
  }

  check("the fulfilment rate card is there", page.includes("Fulfilment rate"));
  check("the average pledge card is there", page.includes("Average pledge"));
  check("the median pledge card is there", page.includes("Median pledge"));

  const kes = (minor: bigint) =>
    `KES ${(minor / 100n).toLocaleString("en-KE")}`;
  check(
    "the outstanding total on the page matches the database",
    page.includes(kes(ageing.totalOutstandingMinor)),
    kes(ageing.totalOutstandingMinor),
  );
  check(
    "the event channel row shows its total",
    page.includes(kes(event.totalMinor)),
    kes(event.totalMinor),
  );

  check(
    "Analytics is in the admin nav, after Payments",
    page.indexOf('href="/admin/analytics"') >
      page.indexOf('href="/admin/payments"'),
  );

  const anonPage = await fetch(`${BASE}/admin/analytics`, { redirect: "manual" });
  check(
    "signed out, it sends you to the login screen",
    anonPage.status === 307 || anonPage.status === 302,
    String(anonPage.status),
  );

  /* -----------------------------------------------------------------------
   * 9. recharts stays where it was put
   * --------------------------------------------------------------------- */

  heading("9. recharts is only on /progress and /admin/analytics");

  const home = await (await fetch(`${BASE}/`)).text();
  const progress = await (await fetch(`${BASE}/progress`)).text();
  const pledgeForm = await (await fetch(`${BASE}/pledge`)).text();

  const scan = async (chunks: string[]) => {
    const hits: string[] = [];
    for (const chunk of chunks) {
      const body = await (await fetch(`${BASE}${chunk}`)).text();
      for (const marker of RECHARTS_MARKERS) {
        if (body.includes(marker)) hits.push(chunk.split("/").pop()!);
      }
    }
    return [...new Set(hits)];
  };

  const homeHits = await scan(chunksIn(home));
  const pledgeHits = await scan(chunksIn(pledgeForm));
  const progressHits = await scan(chunksIn(progress));
  const analyticsHits = await scan(chunksIn(page));

  show([
    { page: "/", chunks: chunksIn(home).length, rechartsChunks: homeHits.length },
    { page: "/pledge", chunks: chunksIn(pledgeForm).length, rechartsChunks: pledgeHits.length },
    { page: "/progress", chunks: chunksIn(progress).length, rechartsChunks: progressHits.length },
    { page: "/admin/analytics", chunks: chunksIn(page).length, rechartsChunks: analyticsHits.length },
  ]);

  check(
    "no chunk the home page loads contains recharts",
    homeHits.length === 0,
    homeHits.join(", ") || "clean",
  );
  check(
    "nor the pledge form",
    pledgeHits.length === 0,
    pledgeHits.join(", ") || "clean",
  );
  check("but /progress does load it", progressHits.length > 0);
  check("and so does /admin/analytics", analyticsHits.length > 0);

  /* -----------------------------------------------------------------------
   * 10. Cleanup
   * --------------------------------------------------------------------- */

  heading("10. cleanup");
  await sweep();

  // The fixtures were in campaign_daily_stats while they existed. Rebuilding
  // from the rows that are left puts the table back to the truth.
  const rebuilt = await snapshots.backfill(db, slug);
  console.log(`  test rows removed, ${rebuilt.daysWritten} snapshot days rebuilt`);

  const afterSweep = await analytics.ageing(db, slug);
  check(
    "the outstanding total is back where it started",
    afterSweep.totalOutstandingMinor === before.ageing.totalOutstandingMinor,
    `${afterSweep.totalOutstandingMinor} against ${before.ageing.totalOutstandingMinor}`,
  );

  const [{ agrees }] = (
    await db.execute(sql`
      select (cds.pledged_minor = t.pledged_minor
              and cds.received_minor = t.received_minor) as agrees
      from campaign_daily_stats cds
      join campaigns c on c.id = cds.campaign_id
      join v_campaign_totals t on t.campaign_id = c.id
      where c.slug = ${CAMPAIGN_SLUG}
        and cds.stat_date = (now() at time zone 'Africa/Nairobi')::date
    `)
  ).rows as { agrees: boolean }[];
  check("and today's snapshot agrees with v_campaign_totals again", agrees === true);

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
