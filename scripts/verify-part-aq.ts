import { config } from "dotenv";

import { provisionAdmin, removeVerificationAdmins } from "./verification-admin";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Session 1D of the security hardening: the held additions queue.
 *
 * A held addition shows on the queue with the phone on record and a count on
 * the nav. Confirming needs a method and applies the money through the edit
 * service as a new admin increment; rejecting leaves the pledge alone. Both
 * are audited, and a confirmation records how it was confirmed.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:held-queue
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const CAMPAIGN_SLUG = "crystal-fountain";
const PASSWORD = "correct-horse-battery-staple";
const PHONE = "0799900601";

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
  const pledges = await import("@/server/services/pledges");
  const campaign = await import("@/server/services/campaign");
  const { normalizeKenyanPhone } = await import("@/server/contracts/phone");
  const { AUDIT_TONES } = await import("@/components/admin/audit-table");
  const { summarise } = await import("@/server/services/audit");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  };

  const phone = normalizeKenyanPhone(PHONE)!;

  const cleanup = async () => {
    await db.execute(sql`
      delete from pledges
      where pledger_id in (select id from pledgers where phone_e164 = ${phone})
    `);
    await db.execute(sql`delete from pledgers where phone_e164 = ${phone}`);
    await removeVerificationAdmins(db);
  };

  await cleanup();

  const signIn = async (role: string) => {
    const email = `verify-part-aq-${role}@example.test`;
    await provisionAdmin(db, { email, password: PASSWORD, fullName: `Queue ${role}`, role });
    const response = await fetch(`${BASE}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    return response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  };

  const base = {
    intent: "one_off" as const,
    recordConsent: true as const,
    contactConsent: false,
    displayConsent: false,
  };

  const hold = async (amountKes: number) => {
    const r = await pledges.create(db, {
      input: { ...base, fullName: "Somebody Else", phone, amountKes },
      campaignSlug: CAMPAIGN_SLUG,
      ownership: { ownedPledgeIds: [] },
    });
    if (!("held" in r)) throw new Error("expected a held addition");
    const row = await db.execute(sql`
      select id::text as id from pledge_increments
      where pledge_id = ${r.pledgeId}::uuid and status = 'held'
      order by id desc limit 1
    `);
    return (row.rows[0] as { id: string }).id;
  };

  const decide = async (cookie: string, id: string, body: unknown) => {
    const response = await fetch(`${BASE}/api/admin/held-additions/${id}`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", origin: BASE },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    return { status: response.status, body: parsed };
  };

  const amount = async (pledgeId: string) => {
    const r = await db.execute(sql`select amount_minor::text as a from pledges where id = ${pledgeId}::uuid`);
    return (r.rows[0] as { a: string }).a;
  };

  try {
    const first = await pledges.create(db, {
      input: { ...base, fullName: "Ruth Achieng Odhiambo", phone, amountKes: 200_000 },
      campaignSlug: CAMPAIGN_SLUG,
    });
    await pledges.approve(db, { pledgeId: first.pledgeId });
    const heldId = await hold(300_000);

    const cookies = {
      viewer: await signIn("viewer"),
      treasurer: await signIn("treasurer"),
    };

    // 1. The queue.
    heading("1. the queue and the badge");
    const page = await (
      await fetch(`${BASE}/admin/held-additions`, { headers: { cookie: cookies.treasurer } })
    ).text();
    check("the treasurer sees the addition on its pledge", page.includes(first.reference) && page.includes("KES 300,000"));
    check("with the whole phone on record", page.includes(phone));
    check("and the nav says how many are waiting", /Held additions[\s\S]{0,400}waiting for an answer/.test(page));
    check("with the buttons", page.includes("Confirm and add"));

    const viewerPage = await (
      await fetch(`${BASE}/admin/held-additions`, { headers: { cookie: cookies.viewer } })
    ).text();
    check("a viewer sees it with the phone masked", viewerPage.includes(first.reference) && !viewerPage.includes(phone));
    check("and no buttons", !viewerPage.includes("Confirm and add"));

    // 2. Refusals.
    heading("2. what is refused");
    const byViewer = await decide(cookies.viewer, heldId, { decision: "reject" });
    check("a viewer cannot decide", byViewer.status === 403, `${byViewer.status}`);

    const noMethod = await decide(cookies.treasurer, heldId, { decision: "confirm" });
    check(
      "confirming without saying how is refused, against the method field",
      noMethod.status === 422 && Boolean((noMethod.body?.errors as Record<string, string> | undefined)?.method),
      `${noMethod.status}`,
    );
    check("and nothing moved", (await amount(first.pledgeId)) === "20000000");

    // 3. Confirming.
    heading("3. confirming with the pledger on the phone on record");
    const totalsBefore = await campaign.getTotals(db, { campaignSlug: CAMPAIGN_SLUG });
    const confirmed = await decide(cookies.treasurer, heldId, {
      decision: "confirm",
      method: "phone_on_record",
    });
    check("is accepted", confirmed.status === 200 && confirmed.body?.status === "confirmed", `${confirmed.status}`);
    check("and the pledge rose by the held amount", (await amount(first.pledgeId)) === "50000000");

    const ledger = await db.execute(sql`
      select id::text as id, amount_minor::text as amount, channel, status, reason
      from pledge_increments where pledge_id = ${first.pledgeId}::uuid order by id
    `);
    show(ledger.rows as Record<string, unknown>[]);
    const rows = ledger.rows as { id: string; amount: string; channel: string; status: string; reason: string | null }[];
    check(
      "the held row is confirmed and stays uncounted",
      rows.some((r) => r.id === heldId && r.status === "confirmed"),
    );
    check(
      "and the money arrived as a new admin increment with the reason",
      rows.some((r) => r.channel === "admin" && r.status === "applied" && r.amount === "30000000" && (r.reason ?? "").includes("phone on record")),
    );

    const totalsAfter = await campaign.getTotals(db, { campaignSlug: CAMPAIGN_SLUG });
    check(
      "the public total moved by exactly that",
      totalsAfter.pledgedMinor - totalsBefore.pledgedMinor === 30_000_000n,
      `${totalsAfter.pledgedMinor - totalsBefore.pledgedMinor}`,
    );

    const audit = await db.execute(sql`
      select action, after ->> 'method' as method from audit_log
      where entity_id = ${first.pledgeId}::uuid and action in ('pledge.addition_confirmed', 'pledge.edited')
      order by id
    `);
    show(audit.rows as Record<string, unknown>[]);
    check(
      "the confirmation is audited with its method, beside the edit",
      (audit.rows as { action: string; method: string | null }[]).some(
        (r) => r.action === "pledge.addition_confirmed" && r.method === "phone_on_record",
      ) && (audit.rows as { action: string }[]).some((r) => r.action === "pledge.edited"),
    );

    const again = await decide(cookies.treasurer, heldId, { decision: "reject" });
    check("a decided addition cannot be decided again", again.status === 409, `${again.status}`);

    // 4. Rejecting.
    heading("4. rejecting");
    const second = await hold(1_000_000);
    const rejected = await decide(cookies.treasurer, second, { decision: "reject" });
    check("is accepted without a method", rejected.status === 200 && rejected.body?.status === "rejected");
    check("and the pledge did not move", (await amount(first.pledgeId)) === "50000000");

    // 5. A pledge that closed meanwhile.
    heading("5. a pledge that closed while the addition waited");
    const third = await hold(50_000);
    await db.execute(sql`update pledges set status = 'cancelled' where id = ${first.pledgeId}::uuid`);
    const closed = await decide(cookies.treasurer, third, { decision: "confirm", method: "in_person" });
    check("cannot be added to", closed.status === 409 && closed.body?.code === "held_addition_pledge_closed", `${closed.status}`);

    // 6. The journal's words.
    heading("6. tones and detail lines");
    check(
      "both decisions have a tone",
      "pledge.addition_confirmed" in AUDIT_TONES && "pledge.addition_rejected" in AUDIT_TONES,
    );
    const line = summarise("pledge.addition_confirmed", null, {
      reference: first.reference,
      addedMinor: "30000000",
      method: "in_person",
    });
    check("and the confirmation says how", line === `${first.reference}, KES 300,000 confirmed with the pledger in person`, line);

    // 7. The verification query.
    heading("7. verification query: every pledge balances against its applied increments");
    const final = await db.execute(sql`
      select count(*)::int as pledges,
             count(*) filter (where p.amount_minor <> coalesce((select sum(i.amount_minor)
               from pledge_increments i where i.pledge_id = p.id and i.status = 'applied'), 0))::int as unbalanced
      from pledges p
    `);
    show(final.rows as Record<string, unknown>[]);
    check("none unbalanced", (final.rows[0] as { unbalanced: number }).unbalanced === 0);
  } finally {
    heading("8. cleanup");
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
