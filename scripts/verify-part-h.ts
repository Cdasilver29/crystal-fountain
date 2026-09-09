import { config } from "dotenv";

import { provisionAdmin, removeVerificationAdmins } from "./verification-admin";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Pledge list filter verification.
 *
 * Builds pledges across several statuses, then checks the filters at the
 * service level and the URL round trip over HTTP as a signed in admin, which is
 * what proves a filter survives a refresh rather than just working once.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:filters
 *
 * Everything it creates is removed at the end, apart from audit_log rows, which
 * are append only by design.
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const CAMPAIGN_SLUG = "crystal-fountain";
const TEST_PHONE_PREFIX = "+2547999";
const ADMIN_EMAIL = "verify-part-h@example.test";
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
  const { createPledgeInput } = await import("@/server/contracts/pledges");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  };

  const sweep = async () => {
    const phones = `${TEST_PHONE_PREFIX}%`;
    await db.execute(sql`
      delete from payment_allocations
      where pledge_id in (
        select id from pledges where pledger_id in (
          select id from pledgers where phone_e164 like ${phones}))
    `);
    await db.execute(sql`
      delete from pledges
      where pledger_id in (select id from pledgers where phone_e164 like ${phones})
    `);
    await db.execute(sql`delete from pledgers where phone_e164 like ${phones}`);
    await removeVerificationAdmins(db);
  };

  await sweep();

  // 0. An admin, so the page can be fetched
  heading("0. sign in");
  const provisioned = await provisionAdmin(db, {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    fullName: "Verification Admin",
    role: "admin",
  });
  check("a verification admin was provisioned", provisioned.adminUserId.length > 0);

  const login = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  check("signed in", cookie.length > 0);

  const adminRow = { id: provisioned.adminUserId };

  // 1. Six pledges across four statuses
  heading("1. the pledges");
  const make = async (fullName: string, phone: string, amountKes: number) =>
    pledges.create(db, {
      input: createPledgeInput.parse({
        fullName,
        phone,
        amountKes,
        intent: "one_off",
        recordConsent: true,
        contactConsent: false,
        displayConsent: false,
      }),
      campaignSlug: CAMPAIGN_SLUG,
    });

  const pendingOne = await make("Filter Pending One", "0799901010", 1_000);
  const pendingTwo = await make("Filter Pending Two", "0799902020", 2_000);
  const verifiedOne = await make("Filter Verified One", "0799903030", 3_000);
  const verifiedTwo = await make("Filter Verified Two", "0799904040", 4_000);
  const cancelled = await make("Filter Cancelled", "0799905050", 5_000);
  const searchable = await make("Wanjiru Kamau Lookup", "0799906060", 6_000);

  await pledges.approve(db, { pledgeId: verifiedOne.pledgeId, adminId: adminRow.id });
  await pledges.approve(db, { pledgeId: verifiedTwo.pledgeId, adminId: adminRow.id });
  await db.execute(sql`
    update pledges set status = 'cancelled' where id = ${cancelled.pledgeId}
  `);

  const mine = new Set([
    pendingOne.pledgeId,
    pendingTwo.pledgeId,
    verifiedOne.pledgeId,
    verifiedTwo.pledgeId,
    cancelled.pledgeId,
    searchable.pledgeId,
  ]);

  show([
    { role: "pending", reference: pendingOne.reference },
    { role: "pending", reference: pendingTwo.reference },
    { role: "verified", reference: verifiedOne.reference },
    { role: "verified", reference: verifiedTwo.reference },
    { role: "cancelled", reference: cancelled.reference },
    { role: "searchable name", reference: searchable.reference },
  ]);

  const listMine = async (args: Parameters<typeof pledges.listForAdmin>[1]) => {
    const page = await pledges.listForAdmin(db, args);
    return {
      page,
      ours: page.items.filter((row) => mine.has(row.id)),
    };
  };

  // 2. Status filter
  heading("2. filter by status");
  const verifiedOnly = await listMine({
    campaignSlug: CAMPAIGN_SLUG,
    status: "verified",
    limit: 100,
  });
  show(
    verifiedOnly.ours.map((r) => ({ reference: r.reference, status: r.status })),
  );
  check(
    "only verified pledges come back",
    verifiedOnly.page.items.every((row) => row.status === "verified"),
  );
  check("both verified pledges are there", verifiedOnly.ours.length === 2);

  const cancelledOnly = await listMine({
    campaignSlug: CAMPAIGN_SLUG,
    status: "cancelled",
    limit: 100,
  });
  check(
    "the cancelled pledge is found under cancelled",
    cancelledOnly.ours.some((row) => row.id === cancelled.pledgeId),
  );
  check(
    "and nowhere else",
    !verifiedOnly.ours.some((row) => row.id === cancelled.pledgeId),
  );

  // 3. Search term
  heading("3. filter by search term");
  const byReference = await listMine({
    campaignSlug: CAMPAIGN_SLUG,
    q: verifiedOne.reference,
    limit: 100,
  });
  show(byReference.ours.map((r) => ({ reference: r.reference, name: r.fullName })));
  check(
    "an exact reference returns that pledge",
    byReference.ours.length === 1 &&
      byReference.ours[0].id === verifiedOne.pledgeId,
  );

  const byName = await listMine({
    campaignSlug: CAMPAIGN_SLUG,
    q: "kamau",
    limit: 100,
  });
  check(
    "a name fragment finds the pledge",
    byName.ours.some((row) => row.id === searchable.pledgeId),
  );

  const byPhone = await listMine({
    campaignSlug: CAMPAIGN_SLUG,
    q: "906060",
    limit: 100,
  });
  check(
    "a phone suffix finds the pledge",
    byPhone.ours.some((row) => row.id === searchable.pledgeId),
  );

  const both = await listMine({
    campaignSlug: CAMPAIGN_SLUG,
    q: "Filter",
    status: "pending",
    limit: 100,
  });
  show(both.ours.map((r) => ({ reference: r.reference, status: r.status })));
  check(
    "search and status combine",
    both.ours.length === 2 &&
      both.ours.every((row) => row.status === "pending"),
  );

  const nothing = await listMine({
    campaignSlug: CAMPAIGN_SLUG,
    q: "zzzznothingmatchesthis",
    limit: 100,
  });
  check("an unmatched term returns nothing", nothing.page.items.length === 0);

  const wildcard = await listMine({
    campaignSlug: CAMPAIGN_SLUG,
    q: "100%",
    limit: 100,
  });
  check(
    "a percent sign is not a wildcard",
    wildcard.page.items.length === 0,
    `${wildcard.page.items.length} rows`,
  );

  // 4. Pagination with filters active
  heading("4. pagination with a filter active");
  const first = await pledges.listForAdmin(db, {
    campaignSlug: CAMPAIGN_SLUG,
    q: "Filter",
    limit: 2,
  });
  check("the filtered first page is full", first.items.length === 2);
  check("it offers a next cursor", first.nextCursor !== null);
  check(
    "every row on it matches the filter",
    first.items.every((row) => mine.has(row.id)),
  );

  const second = await pledges.listForAdmin(db, {
    campaignSlug: CAMPAIGN_SLUG,
    q: "Filter",
    limit: 2,
    cursor: first.nextCursor,
  });
  const firstIds = new Set(first.items.map((r) => r.id));
  show([
    ...first.items.map((r) => ({ page: 1, reference: r.reference })),
    ...second.items.map((r) => ({ page: 2, reference: r.reference })),
  ]);
  check(
    "page two repeats nothing from page one",
    second.items.every((r) => !firstIds.has(r.id)),
  );
  check(
    "page two still matches the filter",
    second.items.every((row) => mine.has(row.id)),
  );

  // Walking every filtered page must find all five "Filter" pledges once each.
  // The sixth test pledge is deliberately named so it does not match "Filter".
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 50; guard++) {
    const page: Awaited<ReturnType<typeof pledges.listForAdmin>> =
      await pledges.listForAdmin(db, {
        campaignSlug: CAMPAIGN_SLUG,
        q: "Filter",
        limit: 2,
        cursor,
      });
    seen.push(...page.items.map((r) => r.id));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  check("walking filtered pages yields no duplicates", new Set(seen).size === seen.length);
  check(
    "walking filtered pages finds all five",
    [pendingOne, pendingTwo, verifiedOne, verifiedTwo, cancelled].every((p) =>
      seen.includes(p.pledgeId),
    ),
  );

  // 5. The URL round trip
  heading("5. the filters survive the URL");
  const as = { headers: { cookie } };

  const plain = await fetch(`${BASE}/admin/pledges`, as).then((r) => r.text());
  check("the unfiltered page lists a pending pledge", plain.includes(pendingOne.reference));

  const statusUrl = await fetch(
    `${BASE}/admin/pledges?status=verified`,
    as,
  ).then((r) => r.text());
  check(
    "status=verified shows the verified pledge",
    statusUrl.includes(verifiedOne.reference),
  );
  check(
    "status=verified hides the pending one",
    !statusUrl.includes(pendingOne.reference),
  );
  check(
    "the dropdown reflects the URL",
    /<option[^>]*value="verified"[^>]*selected/.test(statusUrl) ||
      statusUrl.includes('value="verified" selected'),
  );
  check("a clear link appears", statusUrl.includes("Clear filters"));

  const searchUrl = await fetch(
    `${BASE}/admin/pledges?q=${encodeURIComponent(verifiedOne.reference)}`,
    as,
  ).then((r) => r.text());
  check(
    "q= shows the searched pledge",
    searchUrl.includes(verifiedOne.reference),
  );
  check("q= hides the others", !searchUrl.includes(pendingTwo.reference));
  check(
    "the search box is prefilled from the URL",
    searchUrl.includes(`value="${verifiedOne.reference}"`),
  );

  const bothUrl = await fetch(
    `${BASE}/admin/pledges?q=Filter&status=pending`,
    as,
  ).then((r) => r.text());
  check(
    "q and status together show only pending matches",
    bothUrl.includes(pendingOne.reference) &&
      !bothUrl.includes(verifiedOne.reference),
  );

  const rubbish = await fetch(
    `${BASE}/admin/pledges?status=not-a-status&cursor=garbage`,
    as,
  );
  check(
    "an unreadable filter falls back rather than erroring",
    rubbish.status === 200,
    `status ${rubbish.status}`,
  );

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
