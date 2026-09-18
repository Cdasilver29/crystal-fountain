import { config } from "dotenv";

import { provisionAdmin, removeVerificationAdmins } from "./verification-admin";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * The change request queue, its route, the nav badge and the payment routing.
 *
 * Sessions C2b and C2c. C2a proved the decisions by calling the services;
 * this proves the screen in front of them: that the route refuses the roles it
 * should, that a refused cancellation lands in the journal as an attempt, that
 * the note rule is enforced server side and not only by the textarea, and that
 * the page itself renders what it is supposed to for each role.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:change-queue
 *
 * The server must be signed in against, so BETTER_AUTH_URL has to name the
 * origin it is actually running on. Against a locally started server that is
 * http://localhost:3000, not the deployed origin .env.local carries.
 *
 * Everything it creates is removed at the start and at the end, apart from
 * audit_log rows, which are append only by design.
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const CAMPAIGN_SLUG = "crystal-fountain";
const PASSWORD = "correct-horse-battery-staple";
const PHONES = {
  reduce: "0799900071",
  payment: "0799900074",
  cancel: "0799900072",
  decline: "0799900073",
};
const TEST_IP = "198.51.100.31";
const REASON = "My circumstances have changed and I need to adjust this.";

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
  const requests = await import("@/server/services/change-requests");
  const { normalizeKenyanPhone } = await import("@/server/contracts/phone");
  const { changeRequestInput } = await import(
    "@/server/contracts/change-requests"
  );

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(
      `${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`,
    );
  };

  const e164 = Object.fromEntries(
    Object.entries(PHONES).map(([k, v]) => [k, normalizeKenyanPhone(v)!]),
  ) as Record<keyof typeof PHONES, string>;
  const allPhones = sql.join(
    Object.values(e164).map((p) => sql`${p}`),
    sql`, `,
  );

  const cleanup = async () => {
    await db.execute(sql`
      delete from pledge_change_requests
      where source_ip = ${TEST_IP}::inet
         or pledge_id in (
           select p.id from pledges p
           join pledgers g on g.id = p.pledger_id
           where g.phone_e164 in (${allPhones})
         )
    `);
    await db.execute(sql`
      delete from pledges
      where pledger_id in (
        select id from pledgers where phone_e164 in (${allPhones})
      )
    `);
    await db.execute(sql`
      delete from pledgers where phone_e164 in (${allPhones})
    `);
    await removeVerificationAdmins(db);
  };

  await cleanup();

  /*
   * Three accounts, all signed in at once. The rights suite provisions one at
   * a time because it sweeps between each; here the whole point is one
   * request being reached for by three different roles, so they coexist.
   */
  const cookies: Record<string, string> = {};

  for (const role of ["viewer", "treasurer", "admin"] as const) {
    await provisionAdmin(db, {
      email: `verify-part-ag-${role}@example.test`,
      password: PASSWORD,
      fullName: `Queue ${role}`,
      role,
    });

    const response = await fetch(`${BASE}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: `verify-part-ag-${role}@example.test`,
        password: PASSWORD,
      }),
    });

    const cookie = response.headers.getSetCookie().join("; ");

    if (!cookie) {
      console.error(
        `Could not sign in as ${role} (${response.status}). Is BETTER_AUTH_URL pointing at ${BASE}?`,
      );
      process.exit(1);
    }

    cookies[role] = cookie;
  }

  const makePledge = async (phone: string, amountKes: number) => {
    // The phone arrives normalised: calling the service directly skips the
    // contract, and the contract is what normalises it.
    const made = await pledges.create(db, {
      input: {
        fullName: "Queue Test",
        phone,
        intent: "one_off" as const,
        amountKes,
        recordConsent: true as const,
        contactConsent: false,
        displayConsent: false,
      },
      campaignSlug: CAMPAIGN_SLUG,
    });
    await pledges.approve(db, { pledgeId: made.pledgeId, adminId: null });
    return made;
  };

  const raise = async (
    reference: string,
    phone: string,
    fields: Record<string, unknown>,
  ) => {
    const result = await requests.create(db, {
      input: changeRequestInput.parse({
        reference,
        contactPhoneE164: phone,
        reason: REASON,
        ...fields,
      }),
      campaignSlug: CAMPAIGN_SLUG,
      request: { ip: TEST_IP, userAgent: "verify-part-ag" },
    });
    return result.request;
  };

  const decide = async (
    role: string | null,
    requestId: string,
    body: Record<string, unknown>,
  ) => {
    const response = await fetch(
      `${BASE}/api/admin/change-requests/${requestId}/decide`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(role ? { cookie: cookies[role] } : {}),
        },
        body: JSON.stringify(body),
      },
    );
    const payload = await response.json().catch(() => null);
    return { status: response.status, body: payload };
  };

  /* -----------------------------------------------------------------------
   * 1. The route refuses who it should.
   * --------------------------------------------------------------------- */

  heading("1. who the route lets through");

  const reducible = await makePledge(e164.reduce, 500_000);
  const reduction = await raise(reducible.reference, PHONES.reduce, {
    kind: "reduce_amount",
    requestedAmountMinor: "30000000",
  });

  const anonymous = await decide(null, reduction.id, { decision: "approve" });
  check(
    "a caller with no session is refused",
    anonymous.status === 401,
    `${anonymous.status} ${anonymous.body?.code}`,
  );

  const byViewer = await decide("viewer", reduction.id, {
    decision: "approve",
  });
  check(
    "a viewer is refused",
    byViewer.status === 403 && byViewer.body?.code === "forbidden",
    `${byViewer.status} ${byViewer.body?.code}`,
  );

  const viewerForbidden = await db.execute(sql`
    select count(*)::int as n from audit_log
    where action = 'admin.forbidden'
      and after->>'attempted' = 'changeRequests.decide'
      and at > now() - interval '5 minutes'
  `);
  check(
    "and the attempt is in the journal",
    (viewerForbidden.rows[0] as { n: number }).n >= 1,
  );

  const notAnId = await decide("treasurer", "not-a-uuid", {
    decision: "approve",
  });
  check(
    "a request id that is not one is a 404, not a 500",
    notAnId.status === 404,
    String(notAnId.status),
  );

  /* -----------------------------------------------------------------------
   * 2. A treasurer approves a reduction.
   * --------------------------------------------------------------------- */

  heading("2. approving through the route");

  const approved = await decide("treasurer", reduction.id, {
    decision: "approve",
  });
  show([
    {
      status: approved.status,
      kind: approved.body?.kind,
      requestStatus: approved.body?.status,
      reference: approved.body?.reference,
    },
  ]);
  check("a treasurer may approve a reduction", approved.status === 200);
  check("and it comes back approved", approved.body?.status === "approved");

  const reduced = await db.execute(sql`
    select amount_minor::text as amount_minor from pledges
    where id = ${reducible.pledgeId}::uuid
  `);
  check(
    "the pledge actually moved",
    (reduced.rows[0] as { amount_minor: string }).amount_minor === "30000000",
  );

  const twice = await decide("treasurer", reduction.id, {
    decision: "approve",
  });
  check(
    "answering it again is a conflict, not a second reduction",
    twice.status === 409 && twice.body?.code === "change_request_not_pending",
    `${twice.status} ${twice.body?.code}`,
  );

  /* -----------------------------------------------------------------------
   * 3. Cancelling needs the administrator.
   * --------------------------------------------------------------------- */

  heading("3. the cancellation gate, over HTTP");

  const doomed = await makePledge(e164.cancel, 250_000);
  const cancellation = await raise(doomed.reference, PHONES.cancel, {
    kind: "cancel_pledge",
  });

  const treasurerTries = await decide("treasurer", cancellation.id, {
    decision: "approve",
  });
  check(
    "a treasurer is refused a cancellation",
    treasurerTries.status === 403 &&
      treasurerTries.body?.code === "cancellation_needs_admin",
    `${treasurerTries.status} ${treasurerTries.body?.code}`,
  );

  const attempt = await db.execute(sql`
    select count(*)::int as n from audit_log
    where action = 'admin.forbidden'
      and after->>'attempted' = 'changeRequests.decideCancellation'
      and entity_id = ${cancellation.id}::uuid
  `);
  check(
    "and the attempt is recorded against the request",
    (attempt.rows[0] as { n: number }).n === 1,
  );

  const stillThere = await db.execute(sql`
    select status from pledges where id = ${doomed.pledgeId}::uuid
  `);
  check(
    "the pledge is untouched",
    (stillThere.rows[0] as { status: string }).status === "verified",
  );

  const adminApproves = await decide("admin", cancellation.id, {
    decision: "approve",
  });
  check("an administrator may", adminApproves.status === 200);

  const cancelled = await db.execute(sql`
    select p.status, r.status as request_status
    from pledges p
    join pledge_change_requests r on r.pledge_id = p.id
    where p.id = ${doomed.pledgeId}::uuid
  `);
  const after = cancelled.rows[0] as {
    status: string;
    request_status: string;
  };
  check("and the pledge is cancelled", after.status === "cancelled");
  check(
    "with its request approved rather than closed by its own consequence",
    after.request_status === "approved",
  );

  /* -----------------------------------------------------------------------
   * 4. Declining needs a note, server side.
   * --------------------------------------------------------------------- */

  heading("4. the note rule is enforced by the server");

  const arguing = await makePledge(e164.decline, 100_000);
  const declinable = await raise(arguing.reference, PHONES.decline, {
    kind: "reduce_amount",
    requestedAmountMinor: "5000000",
  });

  const noNote = await decide("treasurer", declinable.id, {
    decision: "decline",
  });
  check(
    "a decline with no note is refused",
    noNote.status === 422 && noNote.body?.code === "validation_failed",
    `${noNote.status} ${noNote.body?.code}`,
  );
  check(
    "and the message names the field the form has to show it against",
    typeof noNote.body?.errors?.note === "string",
    noNote.body?.errors?.note ?? "none",
  );
  /*
   * A sentence, not zod's own wording. A missing field and a short one are
   * different failures inside the schema and both reach the same textarea.
   */
  check(
    "in words a person can act on",
    String(noNote.body?.errors?.note ?? "").includes("Say why"),
    noNote.body?.errors?.note ?? "none",
  );

  const shortNote = await decide("treasurer", declinable.id, {
    decision: "decline",
    note: "no",
  });
  check("a note too short to act on is refused", shortNote.status === 422);

  const stillPending = await requests.getPendingForPledge(db, {
    pledgeId: arguing.pledgeId,
  });
  check(
    "and nothing was decided by either attempt",
    stillPending?.id === declinable.id,
  );

  const declined = await decide("treasurer", declinable.id, {
    decision: "decline",
    note: "You have already paid this in full, so there is nothing to reduce.",
  });
  check("a proper note goes through", declined.status === 200);
  check("and it comes back declined", declined.body?.status === "declined");

  /* -----------------------------------------------------------------------
   * 5. The screen itself.
   * --------------------------------------------------------------------- */

  heading("5. what the page renders for each role");

  const pageFor = async (role: string, query = "") => {
    const response = await fetch(`${BASE}/admin/change-requests${query}`, {
      headers: { cookie: cookies[role] },
    });
    return { status: response.status, html: await response.text() };
  };

  const anonymousPage = await fetch(`${BASE}/admin/change-requests`, {
    redirect: "manual",
  });
  check(
    "a signed out visitor is sent to the login screen",
    anonymousPage.status === 307 || anonymousPage.status === 302,
    String(anonymousPage.status),
  );

  const treasurerPage = await pageFor("treasurer");
  check("a treasurer gets the page", treasurerPage.status === 200);
  check(
    "the nav carries the link",
    treasurerPage.html.includes("/admin/change-requests") &&
      treasurerPage.html.includes("Change requests"),
  );

  // Something still waiting, so the buttons have a row to sit on.
  const waiting = await raise(arguing.reference, PHONES.decline, {
    kind: "change_plan",
    requestedFrequency: "monthly",
  });

  const withRow = await pageFor("treasurer");
  check(
    "a waiting request is on the page",
    withRow.html.includes(arguing.reference),
    arguing.reference,
  );
  check("with the buttons to answer it", withRow.html.includes("Approve"));
  check(
    "and the pledger's own words",
    withRow.html.includes("circumstances have changed"),
  );

  const viewerPage = await pageFor("viewer");
  check("a viewer may read the queue", viewerPage.status === 200);
  check(
    "but is given nothing to press",
    !viewerPage.html.includes(">Approve<") &&
      !viewerPage.html.includes(">Decline<"),
  );
  check(
    "and sees the phone number masked",
    viewerPage.html.includes("•") &&
      !viewerPage.html.includes(e164.decline.slice(4)),
  );
  check(
    "while a treasurer sees it whole",
    withRow.html.includes(e164.decline.slice(4)),
  );

  const filtered = await pageFor("treasurer", "?status=approved");
  check(
    "the status filter reaches the query",
    filtered.status === 200 && !filtered.html.includes(arguing.reference),
  );

  const decided = await pageFor("treasurer", "?status=declined");
  check(
    "and a declined request shows the note the pledger was given",
    decided.html.includes("already paid this in full"),
  );

  /* -----------------------------------------------------------------------
   * 6. The badge on the nav.
   * --------------------------------------------------------------------- */

  heading("6. the pending count on the nav");

  const counted = await requests.countPending(db, {
    campaignSlug: CAMPAIGN_SLUG,
  });
  const bySql = (
    await db.execute(sql`
      select count(*)::int as n
      from pledge_change_requests r
      join pledges p on p.id = r.pledge_id
      join campaigns c on c.id = p.campaign_id
      where c.slug = ${CAMPAIGN_SLUG} and r.status = 'pending'
    `)
  ).rows[0] as { n: number };
  check(
    "the count agrees with the database",
    counted === bySql.n,
    `${counted} = ${bySql.n}`,
  );
  check("and this run left something waiting to show", counted > 0);

  /*
   * The badge is on every admin screen, not only its own, because it exists to
   * be noticed by somebody who came to do something else. There is no admin
   * layout, so each page passes it separately and each page can forget it.
   */
  const badgePages = [
    "/admin/pledges",
    "/admin/payments",
    "/admin/analytics",
    "/admin/change-requests",
    "/admin/users",
  ];

  const badgeResults: Record<string, unknown>[] = [];

  for (const path of badgePages) {
    const response = await fetch(`${BASE}${path}`, {
      headers: { cookie: cookies.admin },
    });
    const html = await response.text();
    const hasLink = html.includes("/admin/change-requests");
    const hasCount = html.includes("waiting for an answer");
    badgeResults.push({ path, status: response.status, hasLink, hasCount });
    check(`${path} carries the badge`, response.status === 200 && hasCount);
  }

  show(badgeResults);

  const viewerBadge = await fetch(`${BASE}/admin/pledges`, {
    headers: { cookie: cookies.viewer },
  });
  const viewerHtml = await viewerBadge.text();
  check(
    "a viewer sees it too, since they may read the queue",
    viewerHtml.includes("waiting for an answer"),
  );

  /* -----------------------------------------------------------------------
   * 7. An approved payment report routes into the payment flow.
   * --------------------------------------------------------------------- */

  heading("7. routing a reported payment");

  const reporter = await makePledge(e164.payment, 400_000);
  const report = await raise(reporter.reference, PHONES.payment, {
    kind: "payment_missing",
    paymentReference: "QVERIFYAG1",
    paymentAmountMinor: "5000000",
    paymentPaidOn: "2026-09-01",
  });

  const paymentsBefore = (
    await db.execute(sql`select count(*)::int as n from payments`)
  ).rows[0] as { n: number };

  const routed = await decide("treasurer", report.id, { decision: "approve" });
  const paymentsAfter = (
    await db.execute(sql`select count(*)::int as n from payments`)
  ).rows[0] as { n: number };

  show([
    {
      status: routed.status,
      paymentReference: routed.body?.payment?.paymentReference,
      amountMinor: routed.body?.payment?.amountMinor,
      existingPaymentId: routed.body?.payment?.existingPaymentId,
    },
  ]);
  check("approving it records no payment", paymentsAfter.n === paymentsBefore.n);
  check(
    "and the route hands back what the payment flow needs",
    routed.body?.payment?.paymentReference === "QVERIFYAG1" &&
      routed.body?.payment?.amountMinor === "5000000" &&
      routed.body?.payment?.paidOn === "2026-09-01",
  );

  const approvedPage = await pageFor("treasurer", "?status=approved");
  check(
    "the card says approving it recorded nothing",
    approvedPage.html.includes("Approving this recorded nothing"),
  );
  check(
    "and links into the existing recording flow, prefilled",
    approvedPage.html.includes("QVERIFYAG1") &&
      approvedPage.html.includes("amountMinor=5000000") &&
      approvedPage.html.includes(`accountRef=${reporter.reference}`),
  );

  /* The form on the other end actually reads those. */
  const prefilled = await fetch(
    `${BASE}/admin/payments/new?ref=QVERIFYAG1&amountMinor=5000000&paidOn=2026-09-01&accountRef=${reporter.reference}`,
    { headers: { cookie: cookies.treasurer } },
  );
  const prefilledHtml = await prefilled.text();
  check("the payment form opens prefilled", prefilled.status === 200);
  check(
    "with the code, the amount in shillings and the date",
    prefilledHtml.includes("QVERIFYAG1") &&
      prefilledHtml.includes("50,000") &&
      prefilledHtml.includes("2026-09-01"),
  );
  check(
    "and the pledge reference as the account the payer quoted",
    prefilledHtml.includes(reporter.reference),
  );

  /*
   * A mangled link is an empty form, not a 500. These come off a query string
   * that anybody can edit.
   */
  const mangled = await fetch(
    `${BASE}/admin/payments/new?amountMinor=not-a-number&paidOn=last-tuesday`,
    { headers: { cookie: cookies.treasurer } },
  );
  check("a mangled prefill is ignored rather than fatal", mangled.status === 200);

  /* -----------------------------------------------------------------------
   * 8. Cleanup.
   * --------------------------------------------------------------------- */

  heading("8. cleanup");

  void waiting;
  await cleanup();

  const left = await db.execute(sql`
    select count(*)::int as n from pledge_change_requests
    where source_ip = ${TEST_IP}::inet
  `);
  check(
    "nothing this suite wrote was left behind",
    (left.rows[0] as { n: number }).n === 0,
  );

  const admins = await db.execute(sql`
    select count(*)::int as n from admin_users
    where email like 'verify-part-ag-%'
  `);
  check(
    "and no verification administrator was left signed in",
    (admins.rows[0] as { n: number }).n === 0,
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
