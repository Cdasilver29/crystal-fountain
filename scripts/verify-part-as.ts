import { config } from "dotenv";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Session 1E of the security hardening: double submission, tested first.
 *
 * The question is whether a pledge can be increased twice by one person's one
 * intention. Two cases. A rapid double press sends two identical submissions
 * at once. A lost response leaves the browser without its answer or its
 * cookie, and the member presses again. If neither doubles a pledge, no
 * idempotency key is needed.
 *
 * Turnstile tokens are single use, but Cloudflare's always pass test keys
 * accept any token any number of times, so that cannot be shown with them.
 * Run with VERIFY_TURNSTILE=spent against a server started with Cloudflare's
 * "token already spent" test secret, 3x0000000000000000000000000000000AA, to
 * show a spent token is refused and nothing is recorded.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:double-submit
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const MODE = process.env.VERIFY_TURNSTILE === "spent" ? "spent" : "pass";
const PHONES = ["0799900901", "0799900902", "0799900903"];
const IP = "198.51.100.170";

function heading(text: string) {
  console.log(`\n== ${text} ==`);
}

async function main() {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const { normalizeKenyanPhone } = await import("@/server/contracts/phone");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  };

  const phones = PHONES.map((p) => normalizeKenyanPhone(p)!);

  const cleanup = async () => {
    for (const p of phones) {
      await db.execute(sql`
        delete from pledges
        where pledger_id in (select id from pledgers where phone_e164 = ${p})
      `);
      await db.execute(sql`delete from pledgers where phone_e164 = ${p}`);
    }
    await db.execute(sql`delete from pledge_submissions where ip = ${IP}::inet`);
  };

  await cleanup();

  const submit = (phone: string, amountKes: number, cookie?: string) =>
    fetch(`${BASE}/api/pledges`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": IP,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify({
        fullName: "Double Presser",
        phone,
        intent: "one_off",
        amountKes,
        recordConsent: true,
        contactConsent: false,
        displayConsent: false,
        turnstileToken: "XXXX.SAME.TOKEN.XXXX",
      }),
    }).then(async (r) => ({
      status: r.status,
      body: (await r.json()) as Record<string, unknown>,
      cookie: r.headers.getSetCookie().find((c) => c.startsWith("cf_owner="))?.split(";")[0],
    }));

  const ledger = async (phone: string) => {
    const r = await db.execute(sql`
      select count(distinct p.id)::int as pledges,
             coalesce(sum(p.amount_minor) filter (where true), 0)::text as amount,
             (select count(*)::int from pledge_increments i join pledges q on q.id = i.pledge_id
               join pledgers r on r.id = q.pledger_id where r.phone_e164 = ${phone} and i.status = 'applied') as applied,
             (select count(*)::int from pledge_increments i join pledges q on q.id = i.pledge_id
               join pledgers r on r.id = q.pledger_id where r.phone_e164 = ${phone} and i.status = 'held') as held
      from pledges p join pledgers pr on pr.id = p.pledger_id
      where pr.phone_e164 = ${phone} and p.deleted_at is null
    `);
    return r.rows[0] as { pledges: number; amount: string; applied: number; held: number };
  };

  try {
    console.log(`mode: Turnstile ${MODE}`);

    if (MODE === "spent") {
      heading("a spent Turnstile token");
      const refused = await submit(phones[0], 100_000);
      check("is refused", refused.status === 422 && refused.body.code === "turnstile_failed", `${refused.status} ${String(refused.body.code)}`);
      const l = await ledger(phones[0]);
      check("and nothing was recorded", l.pledges === 0 && l.applied === 0 && l.held === 0, JSON.stringify(l));
    } else {
      heading("1. a rapid double press: two identical submissions at once");
      const [a, b] = await Promise.all([submit(phones[0], 100_000), submit(phones[0], 100_000)]);
      console.log(`answers: ${a.status} and ${b.status}`);
      const pressed = await ledger(phones[0]);
      console.log(JSON.stringify(pressed));
      check("one pledge, not two", pressed.pledges === 1);
      check("counted once", pressed.amount === "10000000" && pressed.applied === 1, pressed.amount);
      check(
        "the second was held, not added",
        [a.status, b.status].sort().join(",") === "201,202" && pressed.held === 1,
        `${a.status},${b.status}`,
      );

      heading("2. a lost response, then a fresh retry");
      const first = await submit(phones[1], 250_000);
      check("the first is recorded", first.status === 201);
      // The browser never saw that answer, so it never stored the cookie.
      const retry = await submit(phones[1], 250_000);
      const lost = await ledger(phones[1]);
      console.log(JSON.stringify(lost));
      check("the retry is held", retry.status === 202, `${retry.status}`);
      check("and the pledge is counted once", lost.amount === "25000000" && lost.applied === 1, lost.amount);

      heading("3. the owner's own double press on an addition");
      /*
       * Both presses carry the owner's valid cookie, so the hold does not
       * apply. What stops the second in production is that Turnstile tokens
       * are single use: Cloudflare answers a repeated token with
       * timeout-or-duplicate. The always pass test keys used here do not
       * enforce that, so this case reports what happens without it rather
       * than asserting. See the summary.
       */
      const owned = await submit(phones[2], 50_000);
      const [c, d] = await Promise.all([
        submit(phones[2], 75_000, owned.cookie),
        submit(phones[2], 75_000, owned.cookie),
      ]);
      const existing = await ledger(phones[2]);
      console.log(`answers: ${c.status} and ${d.status}`, JSON.stringify(existing));
      const doubled = existing.amount === "20000000";
      console.log(
        doubled
          ? "REPORT  with test keys that accept a token twice, the owner's double press applied twice"
          : "REPORT  the owner's double press applied once",
      );
      check("the owner's pledge holds exactly what was applied", existing.applied === (doubled ? 3 : 2));
    }
  } finally {
    heading("cleanup");
    await cleanup();
  }

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
