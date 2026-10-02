import { config } from "dotenv";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Session 2B of the security hardening: one per recipient limit for every
 * email to a pledger's address.
 *
 * At most three confirmations to one address a day, and at most three held
 * addition notices, both counted in email_sends under a keyed hash of the
 * address. Over a limit only the email is skipped; the pledge or the held
 * addition is recorded as before.
 *
 * Sections 1 and 2 go through a running server started with Cloudflare's
 * always pass test pair and a dummy RESEND_API_KEY, so sends are attempted
 * and refused by Resend but still counted, which is the point. The rest call
 * the service directly. The concurrency check owns its own pool, per
 * CLAUDE.md, rather than queueing on the app's two connections.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:email-limits
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const IP = "198.51.100.190";
const TYPED = "Limit.Test@Example.TEST";
const RECORD = "held.limit@example.test";
const PHONES = ["0799900921", "0799900922", "0799900923", "0799900924", "0799900925"];
const KEY = "verify-part-au-email-limit-key-000000000000";

function heading(text: string) {
  console.log(`\n== ${text} ==`);
}

async function main() {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const { Pool } = await import("@neondatabase/serverless");
  const { drizzle } = await import("drizzle-orm/neon-serverless");
  const schema = await import("@/db/schema");
  const { CAMPAIGN_SLUG } = await import("@/lib/campaign");
  const pledges = await import("@/server/services/pledges");
  const limits = await import("@/server/services/email-limits");
  const { normalizeKenyanPhone } = await import("@/server/contracts/phone");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  };

  // The key the server counts under: derived from the secret, not the secret.
  const serverKey = limits.emailLimitKey(process.env.BETTER_AUTH_SECRET)!;
  const typedHash = limits.recipientHash(TYPED, serverKey);
  const recordHash = limits.recipientHash(RECORD, KEY);
  const raceAddress = `race.${Date.now()}@example.test`;
  const raceHash = limits.recipientHash(raceAddress, KEY);
  const phones = PHONES.map((p) => normalizeKenyanPhone(p)!);
  const allPhones = sql.join(phones.map((p) => sql`${p}`), sql`, `);
  const hashes = sql.join(
    [typedHash, recordHash, raceHash].map((h) => sql`${h}`),
    sql`, `,
  );

  const cleanup = async () => {
    await db.execute(sql`delete from email_sends where recipient_hash in (${hashes})`);
    await db.execute(sql`
      delete from pledges where pledger_id in (
        select id from pledgers where phone_e164 in (${allPhones})
      )
    `);
    await db.execute(sql`delete from pledgers where phone_e164 in (${allPhones})`);
    await db.execute(sql`delete from pledge_submissions where ip = ${IP}::inet`);
  };

  const counted = async (hash: string, kind: string) => {
    const r = await db.execute(sql`
      select count(*)::int as n from email_sends
      where recipient_hash = ${hash} and kind = ${kind}
    `);
    return (r.rows[0] as { n: number }).n;
  };

  await cleanup();

  try {
    heading("0. the table holds no address");
    const columns = await db.execute(sql`
      select column_name from information_schema.columns
      where table_name = 'email_sends' order by ordinal_position
    `);
    const names = (columns.rows as { column_name: string }[]).map((r) => r.column_name);
    console.table(names);
    check(
      "email_sends exists with a hash and no address column",
      names.includes("recipient_hash") && !names.some((n) => /email|address|to$/.test(n)),
      names.join(", "),
    );

    heading("1. four pledges typing one address: three confirmations, four pledges");
    const statuses: number[] = [];
    for (const [i, phone] of PHONES.slice(0, 4).entries()) {
      const response = await fetch(`${BASE}/api/pledges`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": IP },
        body: JSON.stringify({
          fullName: `Limit Tester ${i + 1}`,
          phone,
          // The case differs each time; it is one address.
          email: i % 2 === 0 ? TYPED : TYPED.toLowerCase(),
          intent: "one_off",
          amountKes: 1_000,
          recordConsent: true,
          contactConsent: false,
          displayConsent: false,
          turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
        }),
      });
      statuses.push(response.status);
    }
    check("all four pledges were recorded", statuses.every((s) => s === 201), statuses.join(" "));

    // The send runs after the response, so give it a moment to be counted.
    let confirmations = 0;
    for (let i = 0; i < 20; i++) {
      confirmations = await counted(typedHash, "pledge_confirmation");
      if (confirmations >= 3) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    await new Promise((r) => setTimeout(r, 1500));
    confirmations = await counted(typedHash, "pledge_confirmation");
    check("exactly three confirmations were counted", confirmations === 3, `${confirmations}`);

    const recorded = await db.execute(sql`
      select count(*)::int as n from pledgers where phone_e164 in (${allPhones})
    `);
    check(
      "and the fourth pledge is recorded all the same",
      (recorded.rows[0] as { n: number }).n === 4,
    );

    heading("2. a confirmation does not use up a held notice");
    check("no addition_held rows for that address", (await counted(typedHash, "addition_held")) === 0);

    heading("3. held notices: three a day to the address on record, in the same table");
    const owner = await pledges.create(db, {
      input: {
        fullName: "Held Limit Owner",
        phone: phones[4]!,
        email: RECORD,
        intent: "one_off" as const,
        amountKes: 1_000,
        recordConsent: true as const,
        contactConsent: false,
        displayConsent: false,
      },
      campaignSlug: CAMPAIGN_SLUG,
    });
    const notices: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await pledges.create(db, {
        input: {
          fullName: "Somebody Else",
          phone: phones[4]!,
          email: "someone@example.test",
          intent: "one_off" as const,
          amountKes: 500,
          recordConsent: true as const,
          contactConsent: false,
          displayConsent: false,
        },
        campaignSlug: CAMPAIGN_SLUG,
        ownership: { ownedPledgeIds: [] },
        emailKey: KEY,
      });
      if (!("held" in r)) throw new Error("expected held");
      notices.push(r.notice !== null);
    }
    console.table([{ notices: notices.join(" ") }]);
    check("the first three are offered a notice", notices.slice(0, 3).every(Boolean));
    check("the fourth inside 24 hours is not", notices[3] === false);
    check("three addition_held rows", (await counted(recordHash, "addition_held")) === 3);
    const held = await db.execute(sql`
      select count(*)::int as n from pledge_increments
      where pledge_id = ${owner.pledgeId}::uuid and status = 'held'
    `);
    check("while all four additions are held", (held.rows[0] as { n: number }).n === 4);

    heading("4. no key, no email");
    check(
      "a reservation with no key is refused and counts nothing",
      (await limits.reserveEmail(db, { to: raceAddress, kind: "pledge_confirmation", key: undefined })) === false &&
        (await counted(raceHash, "pledge_confirmation")) === 0,
    );
    const keyless = await pledges.create(db, {
      input: {
        fullName: "Somebody Else",
        // Another pledge: the one above has used its five submissions an hour.
        phone: phones[0]!,
        intent: "one_off" as const,
        amountKes: 500,
        recordConsent: true as const,
        contactConsent: false,
        displayConsent: false,
      },
      campaignSlug: CAMPAIGN_SLUG,
      ownership: { ownedPledgeIds: [] },
    });
    check(
      "a held addition with no key offers no notice",
      "held" in keyless && keyless.notice === null,
    );

    heading("5. a reservation inside a transaction that rolls back is given back");
    await db
      .transaction(async (tx) => {
        const ok = await limits.reserveEmail(tx, {
          to: raceAddress,
          kind: "addition_held",
          key: KEY,
        });
        if (!ok) throw new Error("expected a reservation");
        throw new Error("roll back");
      })
      .catch(() => {});
    check("nothing was kept", (await counted(raceHash, "addition_held")) === 0);

    heading("6. eight at once take exactly three");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
    const own = drizzle(pool, { schema });
    try {
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          limits.reserveEmail(own as unknown as typeof db, {
            to: raceAddress,
            kind: "pledge_confirmation",
            key: KEY,
          }),
        ),
      );
      const taken = results.filter(Boolean).length;
      check("three granted", taken === 3, `${taken}`);
      check("three counted", (await counted(raceHash, "pledge_confirmation")) === 3);
    } finally {
      await pool.end();
    }
  } finally {
    await cleanup();
  }

  console.log(
    failures.length === 0
      ? "\nall checks passed"
      : `\n${failures.length} FAILED:\n  ${failures.join("\n  ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
