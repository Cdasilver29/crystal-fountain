import { config } from "dotenv";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Allocate and remove, driven over HTTP as a signed in admin.
 *
 * This is the one verification that exercises the route handlers with a real
 * session, so it is what proves the role gating rather than inferring it. It
 * provisions the first administrator, signs in, allocates from a suggestion,
 * removes the allocation, then demotes the same account to treasurer and to
 * viewer to check what each is refused.
 *
 * A fresh account has no TOTP enrolled, so signInEmail returns a session
 * directly instead of the twoFactorRedirect the login form would otherwise
 * follow. That is what makes this scriptable.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:allocate-ui
 *
 * Everything it creates is removed at the end, apart from audit_log rows, which
 * are append only by design.
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const CAMPAIGN_SLUG = "crystal-fountain";
const TEST_PHONE_PREFIX = "+2547999";
const PLEDGER_PHONE = "0799912121";
const ADMIN_EMAIL = "verify-part-g@example.test";
const ADMIN_PASSWORD = "correct-horse-battery-staple";

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
  const payments = await import("@/server/services/payments");
  const { createPledgeInput } = await import("@/server/contracts/pledges");
  const { recordPaymentInput } = await import("@/server/contracts/payments");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  };

  /** Removes everything this script creates. Run at both ends. */
  const sweep = async () => {
    const phones = `${TEST_PHONE_PREFIX}%`;
    await db.execute(sql`
      delete from payment_allocations
      where payment_id in (
              select id from payments where external_ref like ${"VERIFYG%"}
            )
         or pledge_id in (
              select id from pledges where pledger_id in (
                select id from pledgers where phone_e164 like ${phones})
            )
    `);
    await db.execute(sql`
      delete from payments
      where external_ref like ${"VERIFYG%"} or payer_msisdn like ${phones}
    `);
    await db.execute(sql`
      delete from pledges
      where pledger_id in (select id from pledgers where phone_e164 like ${phones})
    `);
    await db.execute(sql`delete from pledgers where phone_e164 like ${phones}`);
    // admin_users references auth_users, so the admin row goes first.
    await db.execute(sql`
      delete from admin_users
      where email = ${ADMIN_EMAIL}
         or (email like 'verify-part-%@example.test' and auth_user_id is null)
    `);
    await db.execute(sql`delete from auth_users where email = ${ADMIN_EMAIL}`);
    await db.execute(sql`delete from admin_login_attempts where email = ${ADMIN_EMAIL}`);
  };

  await sweep();

  // 0. Provision the first administrator and sign in
  heading("0. sign in as an administrator");
  const setup = await fetch(`${BASE}/api/admin/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fullName: "Verification Admin",
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      confirmPassword: ADMIN_PASSWORD,
    }),
  });

  if (!setup.ok) {
    console.error(
      `Setup returned ${setup.status}. This script needs an empty admin_users table, ` +
        `because it provisions the first administrator. Body: ${await setup.text()}`,
    );
    process.exit(1);
  }
  check("the first administrator was created", setup.ok);

  const login = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });

  // Every Set-Cookie the auth response carried, replayed as one Cookie header.
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");

  check("signing in returned a session cookie", cookie.length > 0);

  const as = (extra: RequestInit = {}) => ({
    ...extra,
    headers: { ...(extra.headers ?? {}), cookie },
  });

  const [adminRow] = (
    await db.execute(sql`select id from admin_users where email = ${ADMIN_EMAIL}`)
  ).rows as { id: string }[];

  const setRole = async (role: string) => {
    await db.execute(sql`
      update admin_users set role = ${role} where email = ${ADMIN_EMAIL}
    `);
  };

  // 1. A pledge and a payment that points at it
  heading("1. a pledge, and a payment naming it");
  const pledge = await pledges.create(db, {
    input: createPledgeInput.parse({
      fullName: "Allocation UI Testcase",
      phone: PLEDGER_PHONE,
      amountKes: 20_000,
      intent: "one_off",
      recordConsent: true,
      contactConsent: false,
      displayConsent: false,
    }),
    campaignSlug: CAMPAIGN_SLUG,
  });
  await pledges.approve(db, { pledgeId: pledge.pledgeId, adminId: adminRow.id });

  const payment = await payments.record(db, {
    input: recordPaymentInput.parse({
      method: "mpesa",
      externalRef: `VERIFYG${Date.now().toString().slice(-6)}`,
      amountKes: 8_000,
      payerName: "Allocation UI Testcase",
      payerPhone: PLEDGER_PHONE,
      accountRef: pledge.reference,
      paidAt: new Date().toISOString().slice(0, 10),
      note: "verify-part-g",
    }),
    campaignSlug: CAMPAIGN_SLUG,
    adminId: adminRow.id,
  });
  show([
    { pledge: pledge.reference, pledged: "2000000", payment: "800000" },
  ]);

  // 2. The detail page renders, with the suggestion on it
  heading("2. the detail page as an admin");
  const pageResponse = await fetch(
    `${BASE}/admin/payments/${payment.paymentId}`,
    as(),
  );
  const html = await pageResponse.text();
  check("the page returns 200", pageResponse.status === 200);
  check("it shows the unallocated remainder", html.includes("unallocated"));
  check("it names the suggested pledge", html.includes(pledge.reference));
  check("it labels the reference match", html.includes("Reference match"));
  check("an admin sees the search box", html.includes("Search for a pledge"));

  // 3. Allocate through the endpoint the Confirm button calls
  heading("3. allocate from the suggestion");
  const allocate = await fetch(
    `${BASE}/api/admin/payments/${payment.paymentId}/allocations`,
    as({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pledgeId: pledge.pledgeId }),
    }),
  );
  const allocated = await allocate.json();
  show([
    {
      status: allocate.status,
      amount_minor: allocated.amountMinor,
      payment_unallocated: allocated.payment?.unallocatedMinor,
      pledge_paid: allocated.pledge?.paidMinor,
      pledge_outstanding: allocated.pledge?.outstandingMinor,
    },
  ]);
  check("the allocation is created", allocate.status === 201);
  check("it took the whole payment", allocated.amountMinor === "800000");
  check(
    "the payment has nothing left unallocated",
    allocated.payment?.unallocatedMinor === "0",
  );
  check(
    "the pledge outstanding fell to 1200000",
    allocated.pledge?.outstandingMinor === "1200000",
  );

  const afterAllocate = await fetch(
    `${BASE}/admin/payments/${payment.paymentId}`,
    as(),
  ).then((r) => r.text());
  check(
    "the page now reads as fully allocated",
    afterAllocate.includes("All of this payment is allocated"),
  );
  check(
    "an admin sees a remove control",
    afterAllocate.includes("Remove"),
  );

  // 4. A treasurer may allocate but not remove
  heading("4. a treasurer is refused the removal");
  await setRole("treasurer");
  const treasurerRemove = await fetch(
    `${BASE}/api/admin/payments/${payment.paymentId}/allocations/${allocated.allocationId}`,
    as({ method: "DELETE" }),
  );
  const treasurerBody = await treasurerRemove.json();
  show([{ status: treasurerRemove.status, code: treasurerBody.code, title: treasurerBody.title }]);
  check("a treasurer cannot remove", treasurerRemove.status === 403);
  check("the refusal is a forbidden problem", treasurerBody.code === "forbidden");

  const forbiddenRows = await db.execute(sql`
    select action, actor_id, after ->> 'role' as role, after ->> 'attempted' as attempted
    from audit_log
    where action = 'admin.forbidden'
      and actor_id = ${adminRow.id}
      and after ->> 'attempted' = 'payment.deallocate'
  `);
  show(forbiddenRows.rows as Record<string, unknown>[]);
  check(
    "the refusal was written to audit_log",
    forbiddenRows.rows.length === 1,
  );

  const treasurerPage = await fetch(
    `${BASE}/admin/payments/${payment.paymentId}`,
    as(),
  ).then((r) => r.text());
  check(
    "a treasurer still sees the allocation",
    treasurerPage.includes(pledge.reference),
  );

  // 5. A viewer sees the screen but no controls
  heading("5. a viewer sees no controls");
  await setRole("viewer");
  const viewerPage = await fetch(
    `${BASE}/admin/payments/${payment.paymentId}`,
    as(),
  ).then((r) => r.text());
  check("a viewer can read the page", viewerPage.includes(pledge.reference));
  check(
    "a viewer sees no search box",
    !viewerPage.includes("Search for a pledge"),
  );
  check("a viewer sees no remove control", !viewerPage.includes(">Remove"));

  const viewerAllocate = await fetch(
    `${BASE}/api/admin/payments/${payment.paymentId}/allocations`,
    as({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pledgeId: pledge.pledgeId }),
    }),
  );
  check("a viewer cannot allocate", viewerAllocate.status === 403);

  // 6. An admin removes it, and the pledge reverts
  heading("6. an admin removes the allocation");
  await setRole("admin");
  const remove = await fetch(
    `${BASE}/api/admin/payments/${payment.paymentId}/allocations/${allocated.allocationId}`,
    as({ method: "DELETE" }),
  );
  const removed = await remove.json();
  show([
    {
      status: remove.status,
      payment_unallocated: removed.payment?.unallocatedMinor,
      pledge_paid: removed.pledge?.paidMinor,
      pledge_outstanding: removed.pledge?.outstandingMinor,
      pledge_status: removed.pledge?.status,
    },
  ]);
  check("the removal succeeds", remove.status === 200);
  check(
    "the payment is unallocated again",
    removed.payment?.unallocatedMinor === "800000",
  );
  check(
    "the pledge outstanding is back to 2000000",
    removed.pledge?.outstandingMinor === "2000000",
  );

  const balances = await db.execute(sql`
    select p.reference, p.status, b.paid_minor, b.outstanding_minor
    from v_pledge_balances b
    join pledges p on p.id = b.pledge_id
    where b.pledge_id = ${pledge.pledgeId}
  `);
  show(balances.rows as Record<string, unknown>[]);
  const balance = balances.rows[0] as { paid_minor: string };
  check("v_pledge_balances agrees", BigInt(balance.paid_minor) === 0n);

  const surviving = await db.execute(sql`
    select count(*) as total,
           count(*) filter (where reversed_at is not null) as reversed
    from payment_allocations
    where payment_id = ${payment.paymentId}
  `);
  const rows = surviving.rows[0] as { total: string; reversed: string };
  check("the allocation row survives the removal", Number(rows.total) === 1);
  check("and it is marked reversed", Number(rows.reversed) === 1);

  // 7. Clean up
  heading("7. cleanup");
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
