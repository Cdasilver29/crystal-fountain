import { config } from "dotenv";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Session 1C of the security hardening, over HTTP: the ownership cookie.
 *
 * Two modes, because the safe failure has to be proved as well as the
 * working path. Start the server with OWNER_COOKIE_SECRET set and run this as
 * it is; then start it without and run with VERIFY_OWNER_SECRET=absent.
 *
 * With the secret: a new pledge sets an httpOnly, Secure, SameSite=Lax cookie
 * for ninety days; an addition carrying it applies; an addition without it,
 * with a forged one, or with one for a different pledge is held, answers 202
 * and reveals nothing about the pledge.
 *
 * Without the secret: no cookie is ever set, and every addition is held.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:ownership
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const MODE = process.env.VERIFY_OWNER_SECRET === "absent" ? "absent" : "present";
const PHONES = ["0799900501", "0799900502"];
const IP = "198.51.100.150";

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

  const pledge = async (phone: string, amountKes: number, cookie?: string) => {
    const response = await fetch(`${BASE}/api/pledges`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": IP,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify({
        fullName: "Ownership Tester",
        phone,
        intent: "one_off",
        amountKes,
        recordConsent: true,
        contactConsent: false,
        displayConsent: false,
        turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
      }),
    });
    const text = await response.text();
    const setCookie = response.headers.getSetCookie().find((c) => c.startsWith("cf_owner="));
    return {
      status: response.status,
      text,
      body: JSON.parse(text) as Record<string, unknown>,
      setCookie,
      cookie: setCookie?.split(";")[0],
    };
  };

  const amountOf = async (phone: string) => {
    const r = await db.execute(sql`
      select p.amount_minor::text as amount,
             (select count(*)::int from pledge_increments i where i.pledge_id = p.id and i.status = 'held') as held
      from pledges p join pledgers pr on pr.id = p.pledger_id
      where pr.phone_e164 = ${phone} and p.deleted_at is null
    `);
    return r.rows[0] as { amount: string; held: number };
  };

  /** A held answer: 202, and only these three keys, nothing naming the pledge. */
  const isHeldAnswer = (r: Awaited<ReturnType<typeof pledge>>) =>
    r.status === 202 &&
    Object.keys(r.body).sort().join(",") === "addedMinor,currency,status" &&
    r.body.status === "held" &&
    !/CF26-|publicToken|reference|amountMinor"/.test(r.text) &&
    r.setCookie === undefined;

  try {
    console.log(`mode: OWNER_COOKIE_SECRET ${MODE}`);

    heading("1. a first pledge");
    const first = await pledge(phones[0], 100_000);
    check("is recorded", first.status === 201, `${first.status}`);

    if (MODE === "present") {
      check("and sets the ownership cookie", first.setCookie !== undefined);
      const c = first.setCookie ?? "";
      check(
        "httpOnly, Secure, SameSite=Lax, for ninety days",
        /HttpOnly/i.test(c) && /Secure/i.test(c) && /SameSite=Lax/i.test(c) && /Max-Age=7776000/.test(c),
        c.replace(/=[^;]+;/, "=<value>;"),
      );
    } else {
      check("and sets no cookie at all", first.setCookie === undefined);
    }

    heading("2. adding to it");
    const withCookie = await pledge(phones[0], 50_000, first.cookie);
    if (MODE === "present") {
      check(
        "with the cookie it applies, on the same reference",
        withCookie.status === 200 && withCookie.body.reference === first.body.reference,
        `${withCookie.status}`,
      );
      check("and the pledge is the sum", (await amountOf(phones[0])).amount === "15000000");
    } else {
      check("there is no cookie to send, and it is held", isHeldAnswer(withCookie), withCookie.text);
    }

    const before = await amountOf(phones[0]);
    const without = await pledge(phones[0], 9_000_000);
    check("without the cookie it is held and reveals nothing", isHeldAnswer(without), without.text);

    const [payload] = (first.cookie ?? "cf_owner=e30.x").replace("cf_owner=", "").split(".");
    const forged = await pledge(phones[0], 9_000_000, `cf_owner=${payload}.forgedsignature`);
    check("a forged cookie is held", isHeldAnswer(forged), `${forged.status}`);

    const other = await pledge(phones[1], 1_000);
    const crossed = await pledge(phones[0], 9_000_000, other.cookie);
    check("a cookie for a different pledge is held", isHeldAnswer(crossed), `${crossed.status}`);

    const afterAll = await amountOf(phones[0]);
    check(
      "none of the held ones moved the pledge",
      afterAll.amount === before.amount,
      `${before.amount} -> ${afterAll.amount}`,
    );
    check(
      "and each one was recorded as held",
      afterAll.held === before.held + 3,
      `${afterAll.held} held`,
    );
  } finally {
    heading("3. cleanup");
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
