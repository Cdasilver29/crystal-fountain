import { config } from "dotenv";

import { provisionAdmin, removeVerificationAdmins } from "./verification-admin";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Campaign settings.
 *
 * The riskiest screen in the portal, so most of this is about consequences
 * rather than about the form working: that a changed target actually moves the
 * public figure, that a changed paybill actually reaches the page telling
 * somebody how to give, that closing the campaign actually closes it, and that
 * every one of those changes is readable afterwards in the journal.
 *
 * Everything it changes is put back at the end, including the super admin flag
 * it has to borrow.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:settings
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const CAMPAIGN_SLUG = "crystal-fountain";
const PASSWORD = "correct-horse-battery-staple";

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
  const campaign = await import("@/server/services/campaign");
  const { resolvePaymentDetails } = await import("@/lib/payment-details");
  const { MPESA } = await import("@/content/campaign");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(
      `${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`,
    );
  };

  // Everything as it was, so it can all go back.
  const original = await campaign.getSettings(db, {
    campaignSlug: CAMPAIGN_SLUG,
  });

  const realSuper = await db.execute(sql`
    select email from admin_users where is_super
  `);
  const realSuperEmail =
    (realSuper.rows[0] as { email: string } | undefined)?.email ?? null;

  const restore = async () => {
    await db.execute(sql`
      update campaigns
      set target_minor = ${original.targetMinor.toString()}::bigint,
          opening_balance_minor = ${original.openingBalanceMinor.toString()}::bigint,
          auto_approve_limit_minor = ${original.autoApproveLimitMinor?.toString() ?? null},
          is_public = ${original.isPublic},
          mpesa_paybill = ${original.mpesaPaybill},
          mpesa_account_name = ${original.mpesaAccountName},
          bank_name = ${original.bankName},
          bank_branch = ${original.bankBranch},
          bank_account_name = ${original.bankAccountName},
          bank_account = ${original.bankAccount},
          bank_swift = ${original.bankSwift},
          bank_branch_code = ${original.bankBranchCode}
      where slug = ${CAMPAIGN_SLUG}
    `);
    await removeVerificationAdmins(db);
    if (realSuperEmail) {
      await db.execute(sql`update admin_users set is_super = false where is_super`);
      await db.execute(sql`
        update admin_users set is_super = true where email = ${realSuperEmail}
      `);
    }
  };

  await removeVerificationAdmins(db);

  const signIn = async (role: "treasurer" | "admin", sup = false) => {
    const email = `verify-part-y-${role}${sup ? "-super" : ""}@example.test`;
    await provisionAdmin(db, {
      email,
      password: PASSWORD,
      fullName: `Settings ${role}`,
      role,
    });
    if (sup) {
      await db.execute(sql`update admin_users set is_super = false where is_super`);
      await db.execute(sql`
        update admin_users set is_super = true where email = ${email}
      `);
    }
    const response = await fetch(`${BASE}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    return response.headers.getSetCookie().join("; ");
  };

  const cookies = {
    treasurer: await signIn("treasurer"),
    admin: await signIn("admin"),
    super: await signIn("admin", true),
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

  const get = async (path: string) => {
    const response = await fetch(`${BASE}${path}`, { cache: "no-store" });
    return {
      status: response.status,
      body: (await response.text()).replace(/<!-- -->/g, ""),
    };
  };

  const patch = (cookie: string, payload: unknown) =>
    call(cookie, "/api/admin/settings", {
      method: "PATCH",
      body: JSON.stringify(payload),
    });

  try {
    // 1. Who may.
    heading("1. only the super administrator");
    const byTreasurer = await patch(cookies.treasurer, { targetKes: 1 });
    const byAdmin = await patch(cookies.admin, { targetKes: 1 });
    show([
      { role: "treasurer", status: byTreasurer.status },
      { role: "admin", status: byAdmin.status },
    ]);
    check("a treasurer is refused", byTreasurer.status === 403);
    check("an ordinary admin is refused too", byAdmin.status === 403);

    const untouched = await campaign.getSettings(db, {
      campaignSlug: CAMPAIGN_SLUG,
    });
    check(
      "and neither refusal changed anything",
      untouched.targetMinor === original.targetMinor,
    );

    const treasurerPage = await call(cookies.treasurer, "/admin/settings");
    check(
      "the screen itself is closed to them",
      treasurerPage.status === 403 || treasurerPage.status === 404,
      `${treasurerPage.status}`,
    );

    // 2. The figures.
    heading("2. changing the target moves the public figure");
    const beforeTotals = await campaign.getTotals(db, {
      campaignSlug: CAMPAIGN_SLUG,
    });

    const newTarget = 600_000_000;
    const changed = await patch(cookies.super, {
      targetKes: newTarget,
      openingBalanceKes: 2_000_000,
    });
    check("the super administrator may", changed.status === 200, `${changed.status}`);
    check(
      "and is told what moved",
      JSON.stringify(changed.body?.changed) ===
        JSON.stringify(["targetMinor", "openingBalanceMinor"]),
      JSON.stringify(changed.body?.changed),
    );

    const afterTotals = await campaign.getTotals(db, {
      campaignSlug: CAMPAIGN_SLUG,
    });
    show([
      {
        target_before: beforeTotals.targetMinor,
        target_after: afterTotals.targetMinor,
        pledged_before: beforeTotals.pledgedMinor,
        pledged_after: afterTotals.pledgedMinor,
      },
    ]);
    check(
      "the target in the totals view is the new one",
      afterTotals.targetMinor === 60_000_000_000n,
      `${afterTotals.targetMinor}`,
    );
    check(
      "and the opening balance moved the pledged figure with it",
      afterTotals.pledgedMinor - beforeTotals.pledgedMinor ===
        200_000_000n - original.openingBalanceMinor,
      `${afterTotals.pledgedMinor - beforeTotals.pledgedMinor}`,
    );

    // 3. The payment details.
    heading("3. changing the paybill reaches the public pages");
    const beforeHome = await get("/");
    check(
      "the home page shows the built in paybill to start with",
      beforeHome.body.includes(MPESA.paybill),
      MPESA.paybill,
    );

    const newPaybill = "999111";
    await patch(cookies.super, {
      mpesaPaybill: newPaybill,
      bankAccount: "0000000000001",
    });

    const afterHome = await get("/");
    check(
      "and the new one afterwards",
      afterHome.body.includes(newPaybill),
      newPaybill,
    );
    check(
      "with the old one gone",
      !afterHome.body.includes(`Business Number: ${MPESA.paybill}`),
    );

    const redeem = await get("/redeem");
    check("the redeem page uses it too", redeem.body.includes(newPaybill));
    check(
      "and the new bank account number",
      redeem.body.includes("0000000000001"),
    );

    // 4. Falling back.
    heading("4. an empty field falls back to the repo");
    const fallback = resolvePaymentDetails({
      mpesaPaybill: null,
      mpesaAccountName: "",
      bankName: null,
      bankBranch: null,
      bankAccountName: null,
      bankAccount: null,
      bankSwift: null,
      bankBranchCode: null,
    });
    check(
      "a null uses the built in value",
      fallback.paybill === MPESA.paybill,
      fallback.paybill,
    );
    check(
      "and so does an empty string, not a blank on the page",
      fallback.accountName === MPESA.account,
      fallback.accountName,
    );

    await patch(cookies.super, { mpesaPaybill: "" });
    const clearedHome = await get("/");
    check(
      "clearing the box on the screen puts the built in value back",
      clearedHome.body.includes(MPESA.paybill),
    );

    // 5. Closing the campaign.
    heading("5. closing the pledge form");
    const openPledge = await fetch(`${BASE}/api/pledges`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    check(
      "while open, a bad pledge is a validation error and not a refusal",
      openPledge.status === 422,
      `${openPledge.status}`,
    );

    await patch(cookies.super, { isPublic: false });

    const closedPledge = await fetch(`${BASE}/api/pledges`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const closedBody = (await closedPledge.json()) as { code?: string };
    check(
      "closed, every pledge is refused before it is even read",
      closedPledge.status === 403 && closedBody.code === "pledging_closed",
      `${closedPledge.status} ${closedBody.code}`,
    );

    const stillVisible = await get("/");
    check(
      "but the figures stay on the page, because they are already public",
      stillVisible.body.includes("pledged so far"),
    );

    await patch(cookies.super, { isPublic: true });

    // 6. The journal.
    heading("6. the journal");
    const journal = await db.execute(sql`
      select before ->> 'targetMinor' as before_target,
             after  ->> 'targetMinor' as after_target,
             after  ->> 'changed' as changed
      from audit_log
      where action = 'campaign.updated'
        and before ? 'targetMinor'
      order by id desc
      limit 1
    `);
    show(journal.rows as Record<string, unknown>[]);
    const j = journal.rows[0] as {
      before_target: string;
      after_target: string;
      changed: string;
    };
    check("a campaign.updated row exists", journal.rows.length === 1);
    check(
      "recording what the target was and what it became",
      j?.before_target === original.targetMinor.toString() &&
        j?.after_target === "60000000000",
      `${j?.before_target} -> ${j?.after_target}`,
    );

    const paybillRow = await db.execute(sql`
      select before ->> 'mpesaPaybill' as was, after ->> 'mpesaPaybill' as now
      from audit_log
      where action = 'campaign.updated' and after ? 'mpesaPaybill'
      order by id asc limit 1
    `);
    show(paybillRow.rows as Record<string, unknown>[]);
    check(
      "and the paybill change is readable the same way",
      (paybillRow.rows[0] as { now: string })?.now === newPaybill,
    );

    // 7. A save that changes nothing.
    heading("7. a save that changes nothing");
    const before7 = await db.execute(sql`
      select count(*)::int as n from audit_log where action = 'campaign.updated'
    `);
    const noop = await patch(cookies.super, {
      targetKes: 600_000_000,
      isPublic: true,
    });
    const after7 = await db.execute(sql`
      select count(*)::int as n from audit_log where action = 'campaign.updated'
    `);
    check("is accepted", noop.status === 200, `${noop.status}`);
    check(
      "reports nothing changed",
      JSON.stringify(noop.body?.changed) === "[]",
      JSON.stringify(noop.body?.changed),
    );
    check(
      "and writes no audit row",
      (before7.rows[0] as { n: number }).n === (after7.rows[0] as { n: number }).n,
    );

    // 8. What the database refuses outright.
    heading("8. what the database will not hold");
    let negative = false;
    try {
      await db.execute(sql`
        update campaigns set opening_balance_minor = -1 where slug = ${CAMPAIGN_SLUG}
      `);
    } catch {
      negative = true;
    }
    check("a negative opening balance is refused", negative);

    let zeroLimit = false;
    try {
      await db.execute(sql`
        update campaigns set auto_approve_limit_minor = 0 where slug = ${CAMPAIGN_SLUG}
      `);
    } catch {
      zeroLimit = true;
    }
    check(
      "and a zero auto approve limit, which would be a full stop arrived at by leaving a box empty",
      zeroLimit,
    );
  } finally {
    // 9. Put everything back, whatever happened above.
    heading("9. cleanup");
    await restore();
  }

  const restored = await campaign.getSettings(db, {
    campaignSlug: CAMPAIGN_SLUG,
  });
  show([
    {
      target: restored.targetMinor,
      opening: restored.openingBalanceMinor,
      paybill: restored.mpesaPaybill,
      isPublic: restored.isPublic,
    },
  ]);
  check(
    "every setting is back where it started",
    restored.targetMinor === original.targetMinor &&
      restored.openingBalanceMinor === original.openingBalanceMinor &&
      restored.mpesaPaybill === original.mpesaPaybill &&
      restored.isPublic === original.isPublic,
  );

  const superNow = await db.execute(sql`
    select email from admin_users where is_super
  `);
  check(
    "and the real super administrator has it back",
    realSuperEmail === null ||
      (superNow.rows[0] as { email: string } | undefined)?.email ===
        realSuperEmail,
    `${(superNow.rows[0] as { email: string } | undefined)?.email ?? "(none)"}`,
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
