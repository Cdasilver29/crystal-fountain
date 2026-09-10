import { config } from "dotenv";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Progress page, timeseries endpoint and sparkline verification.
 *
 * The check that matters most here is the last one. recharts is about 110kB and
 * the home page is where somebody opening a WhatsApp link lands, so this walks
 * every script the home page actually references and proves none of them
 * contains it, rather than trusting the route size table.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:progress
 *
 * Read only. This creates nothing and deletes nothing.
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const CAMPAIGN_SLUG = "crystal-fountain";

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
  const snapshots = await import("@/server/services/snapshots");
  const { sparklinePoints } = await import("@/components/campaign/sparkline");
  const { NAV_LINKS } = await import("@/content/project");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  };

  const [{ n: dayCount }] = (
    await db.execute(sql`
      select count(*)::int as n from campaign_daily_stats cds
      join campaigns c on c.id = cds.campaign_id where c.slug = ${CAMPAIGN_SLUG}
    `)
  ).rows as { n: number }[];

  // 1. The timeseries endpoint
  heading("1. GET /api/campaign/timeseries");
  const tsRes = await fetch(`${BASE}/api/campaign/timeseries`);
  const ts = (await tsRes.json()) as {
    currency: string;
    days: Record<string, unknown>[];
  };
  show([
    {
      status: tsRes.status,
      cacheControl: tsRes.headers.get("cache-control"),
      days: ts.days.length,
      inDatabase: dayCount,
    },
  ]);
  check("status is 200", tsRes.status === 200);
  check(
    "cached for five minutes at the edge",
    (tsRes.headers.get("cache-control") ?? "").includes("s-maxage=300"),
  );
  check("it returns every snapshot day", ts.days.length === dayCount, `${ts.days.length}`);
  check(
    "oldest first",
    ts.days.length < 2 ||
      String(ts.days[0].date) < String(ts.days[ts.days.length - 1].date),
  );
  check(
    "amounts cross as minor unit strings",
    typeof ts.days[0]?.pledgedMinor === "string",
  );

  /*
   * The privacy check. This is a public endpoint, so CLAUDE.md allows
   * aggregates and nothing else. Asserted against the key names rather than the
   * values, so a column added to the snapshot table later cannot leak through
   * without this failing.
   */
  const allowed = new Set([
    "date",
    "pledgedMinor",
    "receivedMinor",
    "pledgeCount",
    "pledgerCount",
    "newPledges",
    "newPledgedMinor",
  ]);
  const unexpected = Object.keys(ts.days[0] ?? {}).filter((k) => !allowed.has(k));
  check(
    "aggregates only, nothing that identifies anybody",
    unexpected.length === 0,
    unexpected.join(", ") || "no extra fields",
  );

  // 2. The progress page
  heading("2. /progress");
  const progRes = await fetch(`${BASE}/progress`);
  const prog = await progRes.text();
  check("status is 200", progRes.status === 200);
  check("it is titled Campaign progress", prog.includes("Campaign progress"));
  check("the summary names the target", prog.includes("KES 550,000,000"));
  check("the cumulative section is there", prog.includes("Pledges over time"));
  check("the monthly section is there", prog.includes("Pledged each month"));
  check("the metrics section is there", prog.includes("The shape of the giving"));
  check("it ends with the call to action", prog.includes("Make a pledge"));

  const summary = (await (await fetch(`${BASE}/api/campaign/summary`)).json()) as {
    pledgedMinor: string;
    receivedMinor: string;
  };
  const kes = (minor: string) =>
    `KES ${(BigInt(minor) / 100n).toLocaleString("en-KE")}`;
  check(
    "the pledged figure on the page matches the summary API",
    prog.includes(kes(summary.pledgedMinor)),
    kes(summary.pledgedMinor),
  );
  check(
    "the received figure matches too",
    prog.includes(kes(summary.receivedMinor)),
  );

  // 3. The nav
  heading("3. the public nav");
  const labels = NAV_LINKS.map((l) => l.label);
  show([{ order: labels.join(" > ") }]);
  check("Progress sits between FAQ and Updates",
    labels.indexOf("Progress") === labels.indexOf("FAQ") + 1 &&
      labels.indexOf("Updates") === labels.indexOf("Progress") + 1);

  const homeRes = await fetch(`${BASE}/`);
  const home = await homeRes.text();
  check("the home page links to it", home.includes('href="/progress"'));

  // 4. The sparkline
  heading("4. the sparkline on the home tracker");
  const polyline = home.match(/<polyline[^>]*points="([^"]*)"/);
  const pointCount = polyline ? polyline[1].trim().split(/\s+/).length : 0;
  const recent = await snapshots.series(db, {
    campaignSlug: CAMPAIGN_SLUG,
    days: 30,
  });
  show([{ pointsInMarkup: pointCount, daysRead: recent.length }]);

  check("it is in the server rendered markup", polyline !== null);
  check(
    "it has one point per day of history",
    pointCount === Math.min(30, recent.length),
    `${pointCount} for ${recent.length} days`,
  );
  check(
    "it carries no client JavaScript of its own",
    home.includes("<polyline") && !home.includes("sparkline.js"),
  );
  check(
    "fewer than two points draws nothing at all",
    sparklinePoints([]) === null && sparklinePoints(["1"]) === null,
  );

  /*
   * The case the campaign is actually in today. Every day holds the same
   * opening balance, so the range is zero, and dividing by it would put every
   * coordinate at NaN and draw no line at all.
   */
  const flat = sparklinePoints(["100000000", "100000000", "100000000"]);
  check("a flat run draws a flat line rather than NaN", flat !== null && !flat.includes("NaN"), String(flat));
  check(
    "and draws it level",
    new Set((flat ?? "").split(" ").map((pair) => pair.split(",")[1])).size === 1,
  );

  const rising = sparklinePoints(["100", "200", "300"]);
  const ys = (rising ?? "").split(" ").map((pair) => Number(pair.split(",")[1]));
  check("a rising run goes up the box, so y falls", ys[0] > ys[1] && ys[1] > ys[2], String(rising));

  // 5. recharts is nowhere near the home page
  heading("5. recharts is only on /progress");
  const homeChunks = chunksIn(home);
  const progChunks = chunksIn(prog);

  const scan = async (chunks: string[]) => {
    const hits: string[] = [];
    for (const chunk of chunks) {
      const body = await (await fetch(`${BASE}${chunk}`)).text();
      for (const marker of RECHARTS_MARKERS) {
        if (body.includes(marker)) hits.push(`${chunk.split("/").pop()} :: ${marker}`);
      }
    }
    return hits;
  };

  const homeHits = await scan(homeChunks);
  const progHits = await scan(progChunks);
  show([
    { page: "/", chunks: homeChunks.length, rechartsHits: homeHits.length },
    { page: "/progress", chunks: progChunks.length, rechartsHits: progHits.length },
  ]);
  if (progHits.length > 0) console.log(`  ${progHits.join("\n  ")}`);

  check(
    "no chunk the home page loads contains recharts",
    homeHits.length === 0,
    homeHits.join(", ") || "clean",
  );
  check("but /progress does load it", progHits.length > 0);

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
