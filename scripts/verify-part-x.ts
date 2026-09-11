import { config } from "dotenv";

import { provisionAdmin, removeVerificationAdmins } from "./verification-admin";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Removing a pledge, and recording one by hand.
 *
 * The removal half is mostly a sweep. "Excluded from all queries, totals and
 * displays" is only as true as its least careful query, so this checks every
 * surface a pledge can appear on rather than the two obvious ones: the totals,
 * the balances, the treasurer's list, the search the allocation panel uses, the
 * public feed, the redeem lookup, the QR page, the export and the suggestions.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:pledge-delete
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const CAMPAIGN_SLUG = "crystal-fountain";
const PASSWORD = "correct-horse-battery-staple";
const DOOMED_PHONE = "0799900131";
const KEPT_PHONE = "0799900132";

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

  const doomed = normalizeKenyanPhone(DOOMED_PHONE)!;
  const kept = normalizeKenyanPhone(KEPT_PHONE)!;

  /*
   * Order matters, and it runs inward from the leaves.
   *
   * payment_allocations points at both a pledge and the administrator who made
   * it, so removing the verification admins first leaves those rows referencing
   * accounts that no longer exist and the foreign key refuses. Allocations go,
   * then the payments they hung off, then the pledges and pledgers, and only
   * then the people who did it all.
   */
  const wipe = async () => {
    for (const phone of [doomed, kept]) {
      await db.execute(sql`
        delete from payment_allocations where pledge_id in (
          select p.id from pledges p
          join pledgers g on g.id = p.pledger_id
          where g.phone_e164 = ${phone}
        )
      `);
      await db.execute(sql`
        delete from pledges
        where pledger_id in (select id from pledgers where phone_e164 = ${phone})
      `);
      await db.execute(sql`delete from pledgers where phone_e164 = ${phone}`);
    }

    await db.execute(sql`
      delete from payment_allocations where payment_id in (
        select id from payments where external_ref like 'VERIFYPARTX%'
      )
    `);
    await db.execute(sql`
      delete from payments where external_ref like 'VERIFYPARTX%'
    `);

    await removeVerificationAdmins(db);
  };

  await wipe();

  const signIn = async (role: "viewer" | "treasurer" | "admin", sup = false) => {
    const email = `verify-part-x-${role}${sup ? "-super" : ""}@example.test`;
    await provisionAdmin(db, {
      email,
      password: PASSWORD,
      fullName: `Delete ${role}`,
      role,
    });
    if (sup) {
      // The real super admin cannot be borrowed, so one is made for the test
      // and taken away again in cleanup. The unique index allows only one, so
      // any existing flag is stood down first and put back at the end.
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

  const realSuper = await db.execute(sql`
    select email from admin_users where is_super
  `);
  const realSuperEmail =
    (realSuper.rows[0] as { email: string } | undefined)?.email ?? null;

  /**
   * Puts the super flag back where it was found.
   *
   * Safe to call twice and safe to call when nothing was borrowed. Runs from
   * the finally below as well as from cleanup, because a suite that throws
   * halfway must not leave the installation with no super administrator.
   */
  const restoreSuper = async () => {
    if (!realSuperEmail) return;
    await db.execute(sql`update admin_users set is_super = false where is_super`);
    await db.execute(sql`
      update admin_users set is_super = true where email = ${realSuperEmail}
    `);
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

  // 1. Recording a pledge by hand.
  heading("1. recording a pledge by hand");
  const viewerRefused = await call(cookies.treasurer, "/api/admin/pledges", {
    method: "POST",
    body: JSON.stringify({
      fullName: "Hannah Achieng",
      phone: KEPT_PHONE,
      amountKes: 400_000,
      channel: "event",
      displayConsent: true,
      contactConsent: true,
      note: "Pledge card handed in at the 9am service",
    }),
  });
  check(
    "a treasurer may record one",
    viewerRefused.status === 201,
    `${viewerRefused.status}`,
  );

  const keptRef = String(viewerRefused.body?.reference ?? "");
  const keptRow = await db.execute(sql`
    select p.status::text as status, p.channel, p.note, g.display_consent
    from pledges p join pledgers g on g.id = p.pledger_id
    where p.reference = ${keptRef}
  `);
  show(keptRow.rows as Record<string, unknown>[]);
  const kr = keptRow.rows[0] as {
    status: string;
    channel: string;
    note: string;
    display_consent: boolean;
  };
  check("it is verified on entry", kr.status === "verified");
  check("it keeps the channel it arrived by", kr.channel === "event");
  check("the note is stored", kr.note?.includes("9am service"));
  check("and the consent the pledger gave", kr.display_consent === true);

  const adminCreated = await db.execute(sql`
    select count(*)::int as n from audit_log
    where action = 'pledge.admin_created'
      and after ->> 'reference' = ${keptRef}
  `);
  check(
    "a pledge.admin_created row was written",
    (adminCreated.rows[0] as { n: number }).n === 1,
  );

  // 2. A pledge to remove, with money against it.
  heading("2. a pledge with a payment matched to it");
  const target = await call(cookies.treasurer, "/api/admin/pledges", {
    method: "POST",
    body: JSON.stringify({
      fullName: "Doomed Pledger",
      phone: DOOMED_PHONE,
      amountKes: 1_000_000,
      displayConsent: true,
    }),
  });
  const doomedRef = String(target.body?.reference ?? "");
  const doomedId = String(target.body?.pledgeId ?? "");

  const payment = await call(cookies.treasurer, "/api/admin/payments", {
    method: "POST",
    body: JSON.stringify({
      method: "mpesa",
      amountKes: 300_000,
      // A date, not a timestamp. The contract takes the day the money arrived.
      paidAt: new Date().toISOString().slice(0, 10),
      externalRef: "VERIFYPARTX1",
      // Every optional field is sent as an empty string rather than left out.
      // The contract transforms "" to null; undefined is not the same thing to
      // it, which is what the payment form sends too.
      payerName: "Doomed Pledger",
      payerPhone: DOOMED_PHONE,
      accountRef: "",
      note: "",
    }),
  });
  const paymentId = String(payment.body?.paymentId ?? "");
  check(
    "a payment is recorded",
    payment.status === 201,
    `${payment.status} ${payment.text.slice(0, 120)}`,
  );

  const allocated = await call(
    cookies.treasurer,
    `/api/admin/payments/${paymentId}/allocations`,
    {
      method: "POST",
      // Minor units, because this is money crossing the wire.
      body: JSON.stringify({ pledgeId: doomedId, amountMinor: "30000000" }),
    },
  );
  check(
    "and matched to the pledge",
    allocated.status === 201,
    `${allocated.status} ${allocated.text.slice(0, 120)}`,
  );

  const beforeTotals = await campaign.getTotals(db, {
    campaignSlug: CAMPAIGN_SLUG,
  });

  // 3. Who may remove it.
  heading("3. only the super administrator removes a pledge");
  const path = `/api/admin/pledges/${doomedId}/delete`;
  const byTreasurer = await call(cookies.treasurer, path, { method: "POST" });
  const byAdmin = await call(cookies.admin, path, { method: "POST" });
  show([
    { role: "treasurer", status: byTreasurer.status },
    { role: "admin", status: byAdmin.status },
  ]);
  check("a treasurer is refused", byTreasurer.status === 403);
  check("an ordinary admin is refused too", byAdmin.status === 403);

  const stillThere = await db.execute(sql`
    select deleted_at from pledges where id = ${doomedId}::uuid
  `);
  check(
    "and neither refusal touched the pledge",
    (stillThere.rows[0] as { deleted_at: string | null }).deleted_at === null,
  );

  // 4. The removal.
  heading("4. the removal");
  const removed = await call(cookies.super, path, {
    method: "POST",
    body: JSON.stringify({ reason: "Recorded twice by mistake" }),
  });
  check("the super administrator may", removed.status === 200, `${removed.status}`);
  check(
    "and the allocation was reversed on the way out",
    removed.body?.allocationsReversed === 1,
    `${removed.body?.allocationsReversed}`,
  );

  const rowAfter = await db.execute(sql`
    select deleted_at is not null as deleted,
           amount_minor::text as amount_minor,
           reference
    from pledges where id = ${doomedId}::uuid
  `);
  show(rowAfter.rows as Record<string, unknown>[]);
  check("the row is still in the database", rowAfter.rows.length === 1);
  check(
    "marked deleted rather than destroyed",
    (rowAfter.rows[0] as { deleted: boolean }).deleted === true,
  );

  const incrementsKept = await db.execute(sql`
    select count(*)::int as n from pledge_increments where pledge_id = ${doomedId}::uuid
  `);
  check(
    "its increments are kept too",
    (incrementsKept.rows[0] as { n: number }).n >= 1,
  );

  // 5. Gone from everywhere.
  heading("5. gone from every surface");
  const afterTotals = await campaign.getTotals(db, {
    campaignSlug: CAMPAIGN_SLUG,
  });
  const pledgedDelta = afterTotals.pledgedMinor - beforeTotals.pledgedMinor;
  const countDelta = afterTotals.pledgeCount - beforeTotals.pledgeCount;
  show([
    {
      pledged_delta: pledgedDelta,
      count_delta: countDelta,
      received_delta: afterTotals.receivedMinor - beforeTotals.receivedMinor,
    },
  ]);
  check(
    "the pledged total drops by the whole pledge",
    pledgedDelta === -100_000_000n,
    `${pledgedDelta}`,
  );
  check("and the pledge count by one", countDelta === -1, `${countDelta}`);
  check(
    "the received figure is untouched, because the money did arrive",
    afterTotals.receivedMinor === beforeTotals.receivedMinor,
  );

  const balance = await db.execute(sql`
    select count(*)::int as n from v_pledge_balances where pledge_id = ${doomedId}::uuid
  `);
  check(
    "it has no balance row",
    (balance.rows[0] as { n: number }).n === 0,
  );

  const list = await pledges.listForAdmin(db, { campaignSlug: CAMPAIGN_SLUG });
  check(
    "it is off the treasurer's list",
    !list.items.some((r) => r.reference === doomedRef),
  );

  const searched = await pledges.search(db, {
    campaignSlug: CAMPAIGN_SLUG,
    q: doomedRef,
    revealPhone: false,
  });
  check(
    "and cannot be found by search, so no payment can be matched to it",
    searched.length === 0,
    `${searched.length} results`,
  );

  const feed = await pledges.recent(db, { campaignSlug: CAMPAIGN_SLUG });
  check(
    "it is out of the public feed",
    !feed.some((e) => e.firstName === "Doomed"),
  );

  const lookedUp = await pledges.lookup(db, {
    input: { reference: doomedRef, phone: doomed },
    campaignSlug: CAMPAIGN_SLUG,
  });
  check("the redeem lookup cannot find it", lookedUp === null);

  // Over HTTP rather than through the service, because the service writes an
  // audit row and wants a real administrator to attribute it to.
  const csv = await call(cookies.admin, "/api/admin/exports/pledges.csv");
  check("the export downloads", csv.status === 200, `${csv.status}`);
  check("and does not contain it", !csv.text.includes(doomedRef));
  check(
    "though it still contains the pledge that was kept",
    csv.text.includes(keptRef),
  );

  const detail = await pledges.getForAdmin(db, { pledgeId: doomedId });
  check("and the admin detail screen will not open it", detail === null);

  const publicPage = await fetch(
    `${BASE}/p/${String(target.body?.publicToken ?? "x")}`,
  );
  check(
    "its public page is gone",
    publicPage.status === 404,
    `${publicPage.status}`,
  );

  // 6. The pledger is not blocked from pledging again.
  heading("6. the pledger can start over");
  const again = await call(cookies.treasurer, "/api/admin/pledges", {
    method: "POST",
    body: JSON.stringify({
      fullName: "Doomed Pledger",
      phone: DOOMED_PHONE,
      amountKes: 50_000,
    }),
  });
  check(
    "a removed pledge no longer holds its person's place",
    again.status === 201,
    `${again.status}`,
  );
  check(
    "and the new one gets its own reference",
    String(again.body?.reference) !== doomedRef,
    `${again.body?.reference}`,
  );
  check(
    "as a new pledge, not an addition to the removed one",
    again.body?.isAddition === false,
  );

  // 7. The journal.
  heading("7. the journal keeps what the screens cannot show");
  const journal = await db.execute(sql`
    select before ->> 'reference' as reference,
           before ->> 'amountMinor' as amount_minor,
           before ->> 'status' as status,
           after  ->> 'reason' as reason,
           after  ->> 'allocationsReversed' as reversed
    from audit_log
    where action = 'pledge.deleted' and entity_id = ${doomedId}::uuid
  `);
  show(journal.rows as Record<string, unknown>[]);
  const j = journal.rows[0] as {
    reference: string;
    amount_minor: string;
    status: string;
    reason: string;
    reversed: string;
  };
  check("a pledge.deleted row exists", journal.rows.length === 1);
  check(
    "carrying the whole pledge as it was",
    j?.reference === doomedRef &&
      j?.amount_minor === "100000000" &&
      j?.status === "verified",
  );
  check("the reason", j?.reason === "Recorded twice by mistake");
  check("and how many allocations it took with it", j?.reversed === "1");

  const reversals = await db.execute(sql`
    select count(*)::int as n from audit_log
    where action = 'payment.deallocated'
      and after ->> 'because' = 'pledge.deleted'
      and before ->> 'reference' = ${doomedRef}
  `);
  check(
    "each reversed allocation got its own row",
    (reversals.rows[0] as { n: number }).n === 1,
  );

  // 8. Clean up.
  heading("8. cleanup");
  await wipe();
  await restoreSuper();
  const restored = await db.execute(sql`
    select email from admin_users where is_super
  `);
  check(
    "the real super administrator is back",
    realSuperEmail === null ||
      (restored.rows[0] as { email: string } | undefined)?.email ===
        realSuperEmail,
    `${(restored.rows[0] as { email: string } | undefined)?.email ?? "(none)"}`,
  );
  const left = await db.execute(sql`
    select count(*)::int as n from pledgers
    where phone_e164 in (${doomed}, ${kept})
  `);
  check("nothing left behind", (left.rows[0] as { n: number }).n === 0);

  heading("result");
  if (failures.length > 0) {
    console.error(`${failures.length} check(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("all checks passed");
}

/**
 * Puts the super flag back whatever happens.
 *
 * This suite borrows the flag so it can test an action only the super
 * administrator may take. A run that threw partway used to leave it on a
 * verification account that cleanup then deleted, and the installation was left
 * with no super administrator at all: nobody able to create one, change the
 * settings, or remove a pledge. Belt and braces, outside main, so it survives a
 * failure anywhere inside it.
 */
async function restoreSuperAdmin() {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");

  const existing = await db.execute(sql`
    select count(*)::int as n from admin_users where is_super
  `);

  if ((existing.rows[0] as { n: number }).n > 0) return;

  const fixed = await db.execute(sql`
    update admin_users set is_super = true
    where id = (
      select id from admin_users
      where role = 'admin' and is_active
        and email not like 'verify-part-%@example.test'
      order by created_at, id
      limit 1
    )
    returning email
  `);

  if (fixed.rows.length > 0) {
    console.log(
      `\n(restored the super administrator: ${(fixed.rows[0] as { email: string }).email})`,
    );
  }
}

main()
  .then(async () => {
    await restoreSuperAdmin();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    await restoreSuperAdmin().catch(() => undefined);
    process.exit(1);
  });
