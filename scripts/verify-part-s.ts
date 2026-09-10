import { config } from "dotenv";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * The recent pledges feed and the dual progress display.
 *
 * The feed half is mostly a privacy check. Consent decides who appears, so this
 * proves that a pledge from somebody who declined is absent in every form, that
 * a full name never leaves the database, and that the public endpoint carries
 * nothing but a first name, an amount and a time.
 *
 * The progress half checks the arithmetic behind the two fills and the third
 * mini stat, which is the one figure on the card that is not a share of the
 * target.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:feed
 *
 * Everything it creates is removed at the end, apart from audit_log rows, which
 * are append only by design.
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const CAMPAIGN_SLUG = "crystal-fountain";

/** Three consenting pledgers and one who declined. */
const PEOPLE = [
  { phone: "0799900091", name: "Grace Wanjiru", amount: 250_000, consent: true },
  { phone: "0799900092", name: "Peter Otieno", amount: 1_000_000, consent: true },
  { phone: "0799900093", name: "Mary Njeri Kamau", amount: 75_000, consent: true },
  { phone: "0799900094", name: "Silent Benefactor", amount: 9_400_000, consent: false },
] as const;

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
  const pledgeService = await import("@/server/services/pledges");
  const campaign = await import("@/server/services/campaign");
  const { normalizeKenyanPhone } = await import("@/server/contracts/phone");
  const { formatRelativeTime } = await import("@/lib/format");
  const { percentOf } = await import("@/server/money");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(
      `${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`,
    );
  };

  const phones = PEOPLE.map((p) => normalizeKenyanPhone(p.phone)!);

  const cleanup = async () => {
    for (const phone of phones) {
      await db.execute(sql`
        delete from pledges
        where pledger_id in (select id from pledgers where phone_e164 = ${phone})
      `);
      await db.execute(sql`delete from pledgers where phone_e164 = ${phone}`);
    }
  };

  /**
   * Fetches a page with React's text node separators taken out.
   *
   * Server rendering puts an empty comment between two adjacent text nodes, so
   * `out of {amount} target` reaches the browser as
   * `out of <!-- -->KES 550,000,000<!-- --> target`. Matching against the raw
   * body would fail for markup that is perfectly correct, so the separators go
   * before anything is compared.
   */
  const get = async (path: string) => {
    const response = await fetch(`${BASE}${path}`, { cache: "no-store" });
    const raw = await response.text();
    return {
      status: response.status,
      body: raw.replace(/<!-- -->/g, ""),
      raw,
    };
  };

  /**
   * Refetches a page until it says what it should, or gives up.
   *
   * The feed and the totals are held for 30 seconds and invalidated by the
   * routes that write them. This script calls the services directly, which is
   * the right way to test them but means no route handler runs and no tag is
   * revalidated, so the page legitimately keeps serving the previous list until
   * the cache turns over. Waiting for that is the honest thing to do: it proves
   * the page really is server rendered from the database rather than proving
   * only that a cache was warm.
   */
  const waitFor = async (
    path: string,
    predicate: (body: string) => boolean,
    timeoutMs = 45_000,
  ) => {
    const deadline = Date.now() + timeoutMs;
    let last = await get(path);

    while (!predicate(last.body) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      last = await get(path);
    }

    return last;
  };

  await cleanup();

  const before = await campaign.getTotals(db, { campaignSlug: CAMPAIGN_SLUG });

  // 1. The relative wording, before anything touches the database.
  heading("1. how long ago something happened, in words");
  const at = (ms: number) => new Date(Date.now() - ms);
  const cases: [string, string][] = [
    [formatRelativeTime(at(10_000)), "just now"],
    [formatRelativeTime(at(60_000)), "1 minute ago"],
    [formatRelativeTime(at(45 * 60_000)), "45 minutes ago"],
    [formatRelativeTime(at(2 * 3_600_000)), "2 hours ago"],
    [formatRelativeTime(at(26 * 3_600_000)), "yesterday"],
    [formatRelativeTime(at(3 * 86_400_000)), "3 days ago"],
  ];
  show(cases.map(([got, want]) => ({ got, want })));
  for (const [got, want] of cases) {
    check(`"${want}"`, got === want, got);
  }
  check(
    "anything older than a week becomes a date",
    /\d{4}$/.test(formatRelativeTime(at(30 * 86_400_000))),
    formatRelativeTime(at(30 * 86_400_000)),
  );

  // 2. Nothing to show means an empty list, which is what hides the section.
  heading("2. the empty case");
  const empty = await pledgeService.recent(db, {
    campaignSlug: "no-such-campaign",
  });
  check("a campaign with nothing consented yields no entries", empty.length === 0);

  // 3. Four pledges, one of whom declined.
  heading("3. four pledges, three consenting");
  const created = [];
  for (const person of PEOPLE) {
    const result = await pledgeService.create(db, {
      input: {
        fullName: person.name,
        phone: normalizeKenyanPhone(person.phone)!,
        amountKes: person.amount,
        intent: "one_off",
        recordConsent: true,
        contactConsent: false,
        displayConsent: person.consent,
      },
      campaignSlug: CAMPAIGN_SLUG,
    });
    await pledgeService.approve(db, { pledgeId: result.pledgeId });
    created.push({ ...person, ...result });
  }

  const feed = await pledgeService.recent(db, { campaignSlug: CAMPAIGN_SLUG });
  show(
    feed.map((entry) => ({
      firstName: entry.firstName,
      amount: entry.amountMinor,
      when: formatRelativeTime(entry.createdAt),
    })),
  );

  const names = feed.map((entry) => entry.firstName);
  check("the three consenting pledgers are in the feed",
    names.includes("Grace") && names.includes("Peter") && names.includes("Mary"),
    names.join(", "),
  );
  check(
    "first names only, never the full name",
    !names.some((n) => n.includes(" ")) && !names.includes("Njeri"),
    names.join(", "),
  );
  check(
    "the pledger who declined is absent entirely",
    !names.includes("Silent") &&
      !feed.some((entry) => entry.amountMinor === 940_000_000n),
  );
  const times = feed.map((entry) => entry.createdAt.getTime());
  check(
    "newest first",
    times.every((t, i) => i === 0 || times[i - 1] >= t),
    times.map((t) => new Date(t).toISOString().slice(11, 19)).join(" > "),
  );
  check(
    "and never more than ten",
    pledgeService.RECENT_PLEDGE_LIMIT === 10 && feed.length <= 10,
    `${feed.length}`,
  );

  // 4. The endpoint the poll uses.
  heading("4. the public endpoint");
  const api = await get("/api/campaign/recent");
  check("it answers", api.status === 200, `${api.status}`);
  const payload = JSON.parse(api.body) as Record<string, unknown>[];
  show(payload.slice(0, 4));
  const fields = new Set(payload.flatMap((entry) => Object.keys(entry)));
  check(
    "it carries an id, a first name, an amount and a time, and nothing else",
    [...fields].sort().join(",") === "amountMinor,createdAt,firstName,id",
    [...fields].sort().join(","),
  );
  for (const phone of phones) {
    check(
      `no phone number in the payload (${phone.slice(-4)})`,
      !api.body.includes(phone) && !api.body.includes(phone.replace("+254", "0")),
    );
  }
  check(
    "no full names",
    !api.body.includes("Wanjiru") &&
      !api.body.includes("Otieno") &&
      !api.body.includes("Kamau"),
  );
  check(
    "and nothing belonging to the pledger who declined",
    !api.body.includes("Silent") && !api.body.includes("940000000"),
  );

  // 5. The home page.
  heading("5. the feed on the home page");
  const home = await waitFor("/", (body) => body.includes("Grace"));
  check("the section is rendered", home.body.includes("Recent pledges"));
  check(
    "with the consenting first names",
    home.body.includes("Grace") && home.body.includes("Peter"),
  );
  check(
    "server rendered, so it is there without JavaScript",
    home.body.includes("KES 250,000") && home.body.includes("KES 1,000,000"),
  );
  check(
    "and the declining pledger is nowhere on the page",
    !home.body.includes("Silent") && !home.body.includes("KES 9,400,000"),
  );
  const atTracker = home.body.indexOf("pledged so far");
  const atFeed = home.body.indexOf("Recent pledges");
  const atVision = home.body.indexOf('id="vision"');
  check(
    "it sits between the tracker and the vision section",
    atTracker >= 0 && atFeed > atTracker && atVision > atFeed,
    `tracker ${atTracker}, feed ${atFeed}, vision ${atVision}`,
  );

  // 6. The dual progress figures.
  heading("6. the dual progress bar");
  const after = await campaign.getTotals(db, { campaignSlug: CAMPAIGN_SLUG });
  show([
    {
      target: after.targetMinor,
      pledged: after.pledgedMinor,
      received: after.receivedMinor,
      percentPledged: after.percentPledged,
      percentReceived: after.percentReceived,
      percentRedeemed: after.percentRedeemed,
    },
  ]);
  check(
    "redeemed is received over pledged, not over the target",
    after.percentRedeemed ===
      percentOf(after.receivedMinor, after.pledgedMinor),
    `${after.percentRedeemed}%`,
  );
  check(
    "which is a different figure from received over the target",
    after.percentRedeemed !== after.percentReceived,
    `${after.percentRedeemed}% vs ${after.percentReceived}%`,
  );
  check(
    "the received fill never runs past the pledged fill",
    after.percentReceived <= after.percentPledged,
    `${after.percentReceived} <= ${after.percentPledged}`,
  );

  const summary = await get("/api/campaign/summary");
  const totalsDto = JSON.parse(summary.body) as Record<string, unknown>;
  check(
    "the poll endpoint carries it too, so the bar stays right after a refresh",
    typeof totalsDto.percentRedeemed === "number",
    `${totalsDto.percentRedeemed}`,
  );

  check(
    "both fills and both labels are on the home page",
    home.body.includes("tracker-fill") &&
      home.body.includes("tracker-fill-solid") &&
      home.body.includes("received") &&
      home.body.includes("pledged") &&
      home.body.includes("redeemed"),
  );
  check(
    "and the target is named under them",
    home.body.includes("out of KES 550,000,000 target"),
  );

  const progress = await get("/progress");
  check("the progress page still renders", progress.status === 200);
  check(
    "its received card is measured against what was pledged",
    progress.body.includes("of what has been pledged"),
  );
  check(
    "and it shows what is still to come in",
    progress.body.includes("Pledged but not yet received"),
  );

  // 7. Clean up.
  heading("7. cleanup");
  await cleanup();
  const final = await campaign.getTotals(db, { campaignSlug: CAMPAIGN_SLUG });
  show([
    {
      pledged_before: before.pledgedMinor,
      pledged_after: final.pledgedMinor,
      back_to_start: final.pledgedMinor === before.pledgedMinor,
    },
  ]);
  check(
    "totals are back where they started",
    final.pledgedMinor === before.pledgedMinor,
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
