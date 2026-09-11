import { config } from "dotenv";

import { provisionAdmin, removeVerificationAdmins } from "./verification-admin";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * CSV export verification.
 *
 * Downloads both files as a signed in treasurer, parses them, and checks every
 * cell against the database rather than against the response. Then demotes the
 * account to viewer and checks both endpoints refuse it.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:exports
 *
 * Everything it creates is removed at the end, apart from audit_log rows, which
 * are append only by design.
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const CAMPAIGN_SLUG = "crystal-fountain";
const TEST_PHONE_PREFIX = "+2547999";
const ADMIN_EMAIL = "verify-part-i@example.test";
const ADMIN_PASSWORD = "correct-horse-battery-staple";

/** A name that would open as a formula in Excel if it were not escaped. */
const RISKY_NAME = "=cmd|' /c calc'!A1 Mwangi";

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

/** A small RFC 4180 reader, so the file is checked by parsing and not by regex. */
function parseCsv(text: string): string[][] {
  const withoutBom = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < withoutBom.length; i++) {
    const c = withoutBom[i];

    if (quoted) {
      if (c === '"') {
        if (withoutBom[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r" && withoutBom[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else field += c;
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

async function main() {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
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
      delete from payment_allocations
      where payment_id in (select id from payments where external_ref like ${"VERIFYI%"})
         or pledge_id in (
              select id from pledges where pledger_id in (
                select id from pledgers where phone_e164 like ${phones}))
    `);
    await db.execute(sql`
      delete from payments
      where external_ref like ${"VERIFYI%"} or payer_msisdn like ${phones}
    `);
    await db.execute(sql`
      delete from pledges
      where pledger_id in (select id from pledgers where phone_e164 like ${phones})
    `);
    await db.execute(sql`delete from pledgers where phone_e164 like ${phones}`);
    await removeVerificationAdmins(db);
  };

  await sweep();

  heading("0. sign in as a treasurer");
  const provisioned = await provisionAdmin(db, {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    fullName: "Verification Treasurer",
    role: "treasurer",
  });
  const login = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const cookie = login.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
  check("signed in", cookie.length > 0);

  const adminId = provisioned.adminUserId;
  const setRole = (role: string) =>
    db.execute(sql`update admin_users set role = ${role} where email = ${ADMIN_EMAIL}`);

  // 1. Data with the awkward cases in it
  heading("1. fixtures");
  const plain = await pledgeSvc.create(db, {
    input: createPledgeInput.parse({
      fullName: "Export Plain Person",
      phone: "0799931313",
      email: "export.plain@example.test",
      amountKes: 12_000,
      intent: "one_off",
      recordConsent: true,
      contactConsent: false,
      displayConsent: false,
    }),
    campaignSlug: CAMPAIGN_SLUG,
  });
  await pledgeSvc.approve(db, { pledgeId: plain.pledgeId, adminId });

  // A name carrying a comma, a quote and a leading equals sign.
  const risky = await pledgeSvc.create(db, {
    input: createPledgeInput.parse({
      fullName: `${RISKY_NAME}, "the second"`,
      phone: "0799932323",
      amountKes: 3_000,
      intent: "one_off",
      recordConsent: true,
      contactConsent: false,
      displayConsent: false,
    }),
    campaignSlug: CAMPAIGN_SLUG,
  });

  const paid = await paymentSvc.record(db, {
    input: recordPaymentInput.parse({
      method: "mpesa",
      externalRef: `VERIFYI${Date.now().toString().slice(-6)}`,
      amountKes: 12_000,
      payerName: "Export Plain Person",
      payerPhone: "0799931313",
      accountRef: plain.reference,
      paidAt: new Date().toISOString().slice(0, 10),
      note: "verify-part-i",
    }),
    campaignSlug: CAMPAIGN_SLUG,
    adminId,
  });
  await paymentSvc.allocate(db, {
    paymentId: paid.paymentId,
    input: { pledgeId: plain.pledgeId },
    adminId,
  });
  show([
    { pledge: plain.reference, kind: "plain, fully paid" },
    { pledge: risky.reference, kind: "name with = , and a quote" },
  ]);

  const as = { headers: { cookie } };

  // 2. The pledge export
  heading("2. pledges.csv");
  const pledgeRes = await fetch(`${BASE}/api/admin/exports/pledges.csv`, as);
  const pledgeText = await pledgeRes.text();
  const pledgeRows = parseCsv(pledgeText);
  const pHeader = pledgeRows[0];
  const pByRef = new Map(pledgeRows.slice(1).map((r) => [r[0], r]));

  const stamp = new Date().toLocaleDateString("en-CA", {
    timeZone: "Africa/Nairobi",
  });

  check("status is 200", pledgeRes.status === 200);
  check(
    "content type is text/csv; charset=utf-8",
    pledgeRes.headers.get("content-type") === "text/csv; charset=utf-8",
  );
  check(
    "content disposition names today's file",
    pledgeRes.headers.get("content-disposition") ===
      `attachment; filename="pledges-${stamp}.csv"`,
    pledgeRes.headers.get("content-disposition") ?? "",
  );
  check("nothing is cached", (pledgeRes.headers.get("cache-control") ?? "").includes("no-store"));
  check(
    "the header is the agreed columns",
    pHeader.join(",") ===
      "reference,full_name,phone,email,amount_kes,status,created_at,verified_at",
    pHeader.join(","),
  );
  check("no id column of any kind", !pHeader.some((c) => /id/.test(c)));

  const plainRow = pByRef.get(plain.reference);
  show([
    plainRow
      ? Object.fromEntries(pHeader.map((h, i) => [h, plainRow[i]]))
      : { missing: plain.reference },
  ]);

  const [dbPledge] = (
    await db.execute(sql`
      select p.reference, g.full_name, g.phone_e164, g.email, p.amount_minor,
             p.status, p.created_at, p.verified_at
      from pledges p join pledgers g on g.id = p.pledger_id
      where p.id = ${plain.pledgeId}
    `)
  ).rows as Record<string, string>[];

  check("the pledge is in the file", plainRow !== undefined);
  check("full_name matches the database", plainRow?.[1] === dbPledge.full_name);
  // The apostrophe is Excel's text marker, consumed when the file is opened.
  // The number behind it must still be exactly what the database holds.
  check(
    "phone is marked as text for the spreadsheet",
    plainRow?.[2] === `'${dbPledge.phone_e164}`,
    plainRow?.[2],
  );
  check(
    "and the number behind the marker is the whole, unmasked one",
    plainRow?.[2].slice(1) === dbPledge.phone_e164,
  );
  check("email matches", plainRow?.[3] === dbPledge.email);
  check(
    "amount is whole shillings, not minor units",
    plainRow?.[4] === String(BigInt(dbPledge.amount_minor) / 100n),
    `${plainRow?.[4]} from ${dbPledge.amount_minor}`,
  );
  check("status matches", plainRow?.[5] === dbPledge.status);
  check(
    "created_at is ISO 8601",
    plainRow?.[6] === new Date(dbPledge.created_at).toISOString(),
  );
  check(
    "verified_at is ISO 8601",
    plainRow?.[7] === new Date(dbPledge.verified_at).toISOString(),
  );

  const riskyRow = pByRef.get(risky.reference);
  check("the awkward name survived the round trip", riskyRow !== undefined);
  check(
    "a leading equals sign is neutralised",
    riskyRow?.[1].startsWith("'=") === true,
    JSON.stringify(riskyRow?.[1].slice(0, 12)),
  );
  check(
    "the comma and the quotes came back intact",
    riskyRow?.[1] === `'${RISKY_NAME}, "the second"`,
  );
  check(
    "a pledge with no email exports an empty cell, not the word null",
    riskyRow?.[3] === "",
  );
  check(
    "an unverified pledge exports an empty verified_at",
    riskyRow?.[7] === "",
  );

  /*
   * Counted the way the export counts, which excludes soft deleted pledges
   * (services/exports.ts). Without that filter this check failed the moment a
   * treasurer removed a pledge, reporting a short file when the file was right
   * to leave the row out.
   */
  const [{ n: pledgeCount }] = (
    await db.execute(sql`
      select count(*)::int as n from pledges p
      join campaigns c on c.id = p.campaign_id
      where c.slug = ${CAMPAIGN_SLUG}
        and p.deleted_at is null
    `)
  ).rows as { n: number }[];
  check(
    "every pledge in the campaign is in the file",
    pledgeRows.length - 1 === pledgeCount,
    `${pledgeRows.length - 1} rows, ${pledgeCount} in the database`,
  );

  // 3. The payment export
  heading("3. payments.csv");
  const payRes = await fetch(`${BASE}/api/admin/exports/payments.csv`, as);
  const payRows = parseCsv(await payRes.text());
  const payHeader = payRows[0];

  check("status is 200", payRes.status === 200);
  check(
    "content disposition names today's file",
    payRes.headers.get("content-disposition") ===
      `attachment; filename="payments-${stamp}.csv"`,
  );
  check(
    "the header is the agreed columns",
    payHeader.join(",") ===
      "paid_at,method,external_ref,amount_kes,payer_name,payer_phone,account_ref,status,allocation_status",
    payHeader.join(","),
  );

  const payRow = payRows.slice(1).find((r) => r[2]?.startsWith("VERIFYI"));
  show([payRow ? Object.fromEntries(payHeader.map((h, i) => [h, payRow[i]])) : {}]);

  const [dbPay] = (
    await db.execute(sql`
      select paid_at, method, external_ref, amount_minor, payer_name_raw,
             payer_msisdn, account_ref_raw, status
      from payments where id = ${paid.paymentId}
    `)
  ).rows as Record<string, string>[];

  check("the payment is in the file", payRow !== undefined);
  check("paid_at is ISO 8601", payRow?.[0] === new Date(dbPay.paid_at).toISOString());
  check("method matches", payRow?.[1] === dbPay.method);
  check("external_ref matches", payRow?.[2] === dbPay.external_ref);
  check(
    "amount is whole shillings",
    payRow?.[3] === String(BigInt(dbPay.amount_minor) / 100n),
  );
  check(
    "payer_phone is marked as text and otherwise exact",
    payRow?.[5] === `'${dbPay.payer_msisdn}`,
    payRow?.[5],
  );
  check("account_ref matches", payRow?.[6] === dbPay.account_ref_raw);
  check(
    "allocation_status is derived, and this one is fully allocated",
    payRow?.[8] === "fully_allocated",
    payRow?.[8],
  );

  // 3b. The buttons that reach these endpoints
  heading("3b. the download controls on both screens");
  const pledgePage = await fetch(`${BASE}/admin/pledges`, as).then((r) => r.text());
  const paymentPage = await fetch(`${BASE}/admin/payments`, as).then((r) => r.text());
  check(
    "the pledge screen offers the export to a treasurer",
    pledgePage.includes("/api/admin/exports/pledges.csv") &&
      pledgePage.includes("Download CSV"),
  );
  check(
    "the payment screen offers the export to a treasurer",
    paymentPage.includes("/api/admin/exports/payments.csv") &&
      paymentPage.includes("Download CSV"),
  );

  // 4. The audit trail
  heading("4. audit_log");
  const auditRows = await db.execute(sql`
    select action, actor_type, actor_id, entity,
           after ->> 'rowCount' as row_count,
           after ->> 'columns'  as columns
    from audit_log
    where action = 'admin.export' and actor_id = ${adminId}
    order by id
  `);
  show(
    (auditRows.rows as Record<string, unknown>[]).map((r) => ({
      ...r,
      columns: String(r.columns).slice(0, 46) + "...",
    })),
  );
  const actions = auditRows.rows as { entity: string; row_count: string }[];
  check("two export rows were written", actions.length === 2);
  check(
    "one names pledges and one names payments",
    actions.some((r) => r.entity === "pledges") &&
      actions.some((r) => r.entity === "payments"),
  );
  check(
    "the pledge row records how many rows left",
    actions.find((r) => r.entity === "pledges")?.row_count ===
      String(pledgeCount),
  );

  // 5. A viewer is refused
  heading("5. a viewer cannot export");
  await setRole("viewer");
  const vPledges = await fetch(`${BASE}/api/admin/exports/pledges.csv`, as);
  const vPayments = await fetch(`${BASE}/api/admin/exports/payments.csv`, as);
  const vBody = await vPledges.json();
  show([{ pledges: vPledges.status, payments: vPayments.status, code: vBody.code }]);
  check("a viewer is refused the pledge export", vPledges.status === 403);
  check("a viewer is refused the payment export", vPayments.status === 403);
  check("the refusal is a forbidden problem", vBody.code === "forbidden");

  const refused = await db.execute(sql`
    select after ->> 'attempted' as attempted
    from audit_log
    where action = 'admin.forbidden' and actor_id = ${adminId}
    order by id
  `);
  const attempted = (refused.rows as { attempted: string }[]).map((r) => r.attempted);
  check(
    "both refusals were recorded",
    // One action covers both exports now, and both refusals are recorded
    // against it. See ADMIN_ACTIONS in src/lib/permissions.ts.
    attempted.filter((a) => a === "exports.download").length === 2,
    attempted.join(", "),
  );

  const anon = await fetch(`${BASE}/api/admin/exports/pledges.csv`);
  check("a signed out request is refused", anon.status === 401);

  const viewerPledgePage = await fetch(`${BASE}/admin/pledges`, as).then((r) => r.text());
  const viewerPaymentPage = await fetch(`${BASE}/admin/payments`, as).then((r) => r.text());
  check(
    "a viewer is not offered the pledge export",
    !viewerPledgePage.includes("/api/admin/exports/pledges.csv"),
  );
  check(
    "a viewer is not offered the payment export",
    !viewerPaymentPage.includes("/api/admin/exports/payments.csv"),
  );
  check(
    "but a viewer can still read the pledge screen",
    viewerPledgePage.includes("Pledges"),
  );

  // 5b. The escaping rule itself, at the boundary between the two cases
  heading("5b. formula escaping, escaping only what can execute");
  const { csvField } = await import("@/server/csv");
  const cases: [string, string, string][] = [
    ["a phone number is not escaped as a formula", "+254712345678", "+254712345678"],
    ["a negative amount is untouched", "-1500", "-1500"],
    ["a formula behind a plus is escaped", "+cmd|' /c calc'!A1", "'+cmd|' /c calc'!A1"],
    ["a formula behind a minus is escaped", "-2+3+cmd", "'-2+3+cmd"],
    ["an equals sign is escaped", "=SUM(A1)", "'=SUM(A1)"],
    ["an at sign is escaped", "@SUM(A1)", "'@SUM(A1)"],
    ["an ordinary name is untouched", "Grace Mwangi", "Grace Mwangi"],
    ["a comma forces quoting", "Mwangi, Grace", '"Mwangi, Grace"'],
    ["a quote is doubled", 'He said "yes"', '"He said ""yes"""'],
  ];
  for (const [label, input, expected] of cases) {
    check(label, csvField(input) === expected, `got ${csvField(input)}`);
  }

  const { csvText } = await import("@/server/csv");
  check(
    "csvText marks a phone as text for the spreadsheet",
    csvText("+254712345678") === "'+254712345678",
  );
  check("csvText leaves a missing value missing", csvText(null) === null);
  check("csvText leaves an empty value empty", csvText("") === "");

  // 6. Clean up
  heading("6. cleanup");
  await sweep();
  console.log("  test rows removed");

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
