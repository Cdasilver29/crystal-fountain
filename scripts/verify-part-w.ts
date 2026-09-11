import { config } from "dotenv";

import { provisionAdmin, removeVerificationAdmins } from "./verification-admin";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * The pledge detail screen and correcting a pledge.
 *
 * The point of this one is the increment ledger. A correction has to leave the
 * original submissions readable and the database's own invariant intact, so
 * this proves the adjustment row exists, that it carries a reason, that the
 * sum still equals the amount, and that a correction with no reason is refused
 * by the database and not merely by the form.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:pledge-edit
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const CAMPAIGN_SLUG = "crystal-fountain";
const PASSWORD = "correct-horse-battery-staple";
const PHONE = "0799900121";

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

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(
      `${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`,
    );
  };

  const phone = normalizeKenyanPhone(PHONE)!;

  const wipe = async () => {
    await removeVerificationAdmins(db);
    await db.execute(sql`
      delete from pledges
      where pledger_id in (select id from pledgers where phone_e164 = ${phone})
    `);
    await db.execute(sql`delete from pledgers where phone_e164 = ${phone}`);
  };

  await wipe();

  const signIn = async (role: "viewer" | "treasurer" | "admin") => {
    await provisionAdmin(db, {
      email: `verify-part-w-${role}@example.test`,
      password: PASSWORD,
      fullName: `Edit ${role}`,
      role,
    });
    const response = await fetch(`${BASE}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: `verify-part-w-${role}@example.test`,
        password: PASSWORD,
      }),
    });
    return response.headers.getSetCookie().join("; ");
  };

  const cookies = {
    viewer: await signIn("viewer"),
    treasurer: await signIn("treasurer"),
    admin: await signIn("admin"),
  };

  const call = async (cookie: string, path: string, init: RequestInit = {}) => {
    const response = await fetch(`${BASE}${path}`, {
      headers: { cookie, "content-type": "application/json" },
      ...init,
    });
    const text = await response.text();
    let body: Record<string, unknown> | null = null;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = null;
    }
    return { status: response.status, body, text };
  };

  // 1. A pledge made of two submissions.
  heading("1. a pledge with a history");
  const base = {
    fullName: "Grace Wanjiru Mwangi",
    phone,
    intent: "one_off" as const,
    recordConsent: true as const,
    contactConsent: false,
    displayConsent: false,
  };

  const first = await pledges.create(db, {
    input: {
      ...base,
      amountKes: 2_000_000,
      intent: "installment",
      installmentFrequency: "quarterly",
      category: "family",
      tier: "family_1m_to_10m",
    },
    campaignSlug: CAMPAIGN_SLUG,
  });
  /*
   * The second submission carries the plan too.
   *
   * A submission without one is a one off, and accumulation re-plans the whole
   * pledge from whatever the latest submission said, so leaving it off here
   * would clear the quarterly plan before the correction ever ran and this
   * would be testing the wrong thing.
   */
  await pledges.create(db, {
    input: {
      ...base,
      amountKes: 3_000_000,
      intent: "installment",
      installmentFrequency: "quarterly",
    },
    campaignSlug: CAMPAIGN_SLUG,
  });
  await pledges.approve(db, { pledgeId: first.pledgeId });

  const detail = await pledges.getForAdmin(db, { pledgeId: first.pledgeId });
  show(
    detail!.increments.map((i) => ({
      amount: i.amountMinor,
      channel: i.channel,
      reason: i.reason,
    })),
  );
  check("the detail loads", detail !== null);
  check("with both submissions", detail!.increments.length === 2);
  check(
    "summing to the pledged amount",
    detail!.increments.reduce((a, i) => a + i.amountMinor, 0n) ===
      detail!.amountMinor,
    `${detail!.amountMinor}`,
  );
  check(
    "and it carries the contact details only an admin may see",
    detail!.phone === phone && detail!.fullName === "Grace Wanjiru Mwangi",
  );

  const totalsBefore = await campaign.getTotals(db, {
    campaignSlug: CAMPAIGN_SLUG,
  });

  // 2. Who may correct it.
  heading("2. who may correct a pledge");
  const path = `/api/admin/pledges/${first.pledgeId}/edit`;
  const attempt = (cookie: string) =>
    call(cookie, path, {
      method: "PATCH",
      body: JSON.stringify({ note: "probing" }),
    });

  const asViewer = await attempt(cookies.viewer);
  const asTreasurer = await attempt(cookies.treasurer);
  show([
    { role: "viewer", status: asViewer.status },
    { role: "treasurer", status: asTreasurer.status },
  ]);
  check("a viewer is refused", asViewer.status === 403, `${asViewer.status}`);
  check(
    "a treasurer is refused, because approving is not rewriting",
    asTreasurer.status === 403,
    `${asTreasurer.status}`,
  );

  // 3. An amount change needs a reason.
  heading("3. a correction needs a reason");
  const noReason = await call(cookies.admin, path, {
    method: "PATCH",
    body: JSON.stringify({ amountKes: 4_200_000 }),
  });
  check(
    "the contract refuses an amount with no reason",
    noReason.status === 422,
    `${noReason.status}`,
  );

  let dbRefused = false;
  try {
    await db.execute(sql`
      insert into pledge_increments (pledge_id, amount_minor, channel)
      values (${first.pledgeId}::uuid, -100, 'admin')
    `);
  } catch {
    dbRefused = true;
  }
  check("and so does the database, independently", dbRefused);

  let webRefused = false;
  try {
    await db.execute(sql`
      insert into pledge_increments (pledge_id, amount_minor, channel, reason)
      values (${first.pledgeId}::uuid, -100, 'web', 'a reason')
    `);
  } catch {
    webRefused = true;
  }
  check(
    "a pledger's own submission can never subtract, reason or not",
    webRefused,
  );

  // 4. The correction itself.
  heading("4. correcting the amount");
  const corrected = await call(cookies.admin, path, {
    method: "PATCH",
    body: JSON.stringify({
      amountKes: 4_200_000,
      reason: "Treasurer confirmed the pledge card says 4,200,000",
    }),
  });
  check("it saves", corrected.status === 200, `${corrected.status}`);

  const after = await pledges.getForAdmin(db, { pledgeId: first.pledgeId });
  show(
    after!.increments.map((i) => ({
      amount: i.amountMinor,
      channel: i.channel,
      reason: i.reason ? `${i.reason.slice(0, 34)}...` : null,
    })),
  );
  check(
    "the amount is what was asked for",
    after!.amountMinor === 420_000_000n,
    `${after!.amountMinor}`,
  );
  check(
    "the original submissions are untouched",
    after!.increments[0].amountMinor === 200_000_000n &&
      after!.increments[1].amountMinor === 300_000_000n,
  );
  check(
    "a third row carries the difference",
    after!.increments.length === 3 &&
      after!.increments[2].amountMinor === -80_000_000n,
    `${after!.increments[2]?.amountMinor}`,
  );
  check(
    "on the admin channel, with the reason on it",
    after!.increments[2].channel === "admin" &&
      (after!.increments[2].reason ?? "").includes("pledge card"),
  );
  check(
    "and the sum still equals the amount, which the trigger enforces",
    after!.increments.reduce((a, i) => a + i.amountMinor, 0n) ===
      after!.amountMinor,
  );

  // 5. The plan follows the new total.
  heading("5. the instalment figure is recomputed");
  show([
    {
      frequency: after!.installmentFrequency,
      instalment: after!.installmentAmountMinor,
      expected: "4,200,000 over 12 quarters = 350,000",
    },
  ]);
  check(
    "the plan survived the correction",
    after!.installmentFrequency === "quarterly",
  );
  check(
    "and each payment is worked out from the corrected total",
    after!.installmentAmountMinor === 35_000_000n,
    `${after!.installmentAmountMinor}`,
  );

  // 6. The journal.
  heading("6. what the journal says");
  const audit = await db.execute(sql`
    select action,
           before ->> 'amountMinor' as before_amount,
           after  ->> 'amountMinor' as after_amount,
           after  ->> 'adjustmentMinor' as adjustment,
           after  ->> 'reason' as reason,
           after  ->> 'changed' as changed
    from audit_log
    where entity_id = ${first.pledgeId}::uuid and action = 'pledge.edited'
    order by id desc
    limit 1
  `);
  show(audit.rows as Record<string, unknown>[]);
  const row = audit.rows[0] as {
    before_amount: string;
    after_amount: string;
    adjustment: string;
    reason: string;
    changed: string;
  };
  check("a pledge.edited row was written", audit.rows.length === 1);
  check(
    "recording what it was and what it became",
    row?.before_amount === "500000000" && row?.after_amount === "420000000",
    `${row?.before_amount} -> ${row?.after_amount}`,
  );
  check(
    "the adjustment and the reason",
    row?.adjustment === "-80000000" && row?.reason?.includes("pledge card"),
  );
  check(
    "and which fields moved",
    (row?.changed ?? "").includes("amount"),
    row?.changed,
  );

  // 7. The public figure moved with it.
  heading("7. the campaign total");
  const totalsAfter = await campaign.getTotals(db, {
    campaignSlug: CAMPAIGN_SLUG,
  });
  const delta = totalsAfter.pledgedMinor - totalsBefore.pledgedMinor;
  show([
    {
      pledged_before: totalsBefore.pledgedMinor,
      pledged_after: totalsAfter.pledgedMinor,
      delta,
    },
  ]);
  check(
    "a verified pledge corrected downward takes the difference off the total",
    delta === -80_000_000n,
    `${delta}`,
  );

  // 8. Identity cannot be edited.
  heading("8. what the edit will not accept");
  const identity = await call(cookies.admin, path, {
    method: "PATCH",
    body: JSON.stringify({
      reference: "CF26-999999",
      publicToken: "somethingelseentirely",
      fullName: "Someone Else",
      phone: "0700000000",
      note: "trying it on",
    }),
  });
  const stillMine = await pledges.getForAdmin(db, { pledgeId: first.pledgeId });
  check("the request is accepted", identity.status === 200);
  check(
    "but the reference is unchanged",
    stillMine!.reference === detail!.reference,
    stillMine!.reference,
  );
  check(
    "the token is unchanged, so the QR still resolves",
    stillMine!.publicToken === detail!.publicToken,
  );
  check(
    "the name and phone are unchanged",
    stillMine!.fullName === "Grace Wanjiru Mwangi" && stillMine!.phone === phone,
  );
  check("and only the note actually moved", stillMine!.note === "trying it on");

  // 9. A no-op writes nothing.
  heading("9. a save that changes nothing");
  const before9 = await db.execute(sql`
    select count(*)::int as n from audit_log
    where entity_id = ${first.pledgeId}::uuid and action = 'pledge.edited'
  `);
  const noop = await call(cookies.admin, path, {
    method: "PATCH",
    body: JSON.stringify({ note: "trying it on" }),
  });
  const after9 = await db.execute(sql`
    select count(*)::int as n from audit_log
    where entity_id = ${first.pledgeId}::uuid and action = 'pledge.edited'
  `);
  check("is accepted", noop.status === 200, `${noop.status}`);
  check(
    "and writes no audit row, because nothing was corrected",
    (before9.rows[0] as { n: number }).n === (after9.rows[0] as { n: number }).n,
    `${(before9.rows[0] as { n: number }).n} rows either side`,
  );

  // 10. The screen itself.
  heading("10. the detail screen");
  const page = await fetch(`${BASE}/admin/pledges/${first.pledgeId}`, {
    headers: { cookie: cookies.admin },
  });
  const html = (await page.text()).replace(/<!-- -->/g, "");
  check("it renders", page.status === 200, `${page.status}`);
  check("showing the reference", html.includes(detail!.reference));
  check("what it is made of", html.includes("What it is made of"));
  check("and the correction reason", html.includes("pledge card"));

  const viewerPage = await fetch(`${BASE}/admin/pledges/${first.pledgeId}`, {
    headers: { cookie: cookies.viewer },
  });
  const viewerHtml = (await viewerPage.text()).replace(/<!-- -->/g, "");
  check("a viewer may read it", viewerPage.status === 200);
  check(
    "but is offered no edit control",
    !viewerHtml.includes("Edit pledge"),
  );

  // 11. Clean up.
  heading("11. cleanup");
  await wipe();
  const left = await db.execute(sql`
    select count(*)::int as n from pledgers where phone_e164 = ${phone}
  `);
  check("nothing left behind", (left.rows[0] as { n: number }).n === 0);
  const finalTotals = await campaign.getTotals(db, {
    campaignSlug: CAMPAIGN_SLUG,
  });
  /*
   * totalsBefore was read after the pledge was approved, so it already counted
   * the full 5,000,000. Removing the pledge takes off what it is worth now,
   * 4,200,000, and the correction had already taken off the other 800,000, so
   * the figure lands exactly 5,000,000 below where it started.
   */
  check(
    "and the campaign figure is back where it was before this pledge counted",
    finalTotals.pledgedMinor === totalsBefore.pledgedMinor - 500_000_000n,
    `${finalTotals.pledgedMinor} against ${totalsBefore.pledgedMinor - 500_000_000n}`,
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
