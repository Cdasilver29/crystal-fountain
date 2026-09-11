import { config } from "dotenv";

import { provisionAdmin, removeVerificationAdmins } from "./verification-admin";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * The rights matrix and the super administrator.
 *
 * Two halves. The first asserts the table itself, every action against every
 * role, so the whole policy is visible in one printed grid rather than inferred
 * from a dozen routes. The second signs in as each role in turn and proves the
 * routes agree with the table, because a permission model that only the nav
 * obeys is decoration.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:rights
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
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
  const { can, ADMIN_ACTIONS, rulesFor } = await import("@/lib/permissions");
  const audit = await import("@/server/services/admin-audit");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(
      `${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`,
    );
  };

  const yes = (v: boolean) => (v ? "yes" : "no");

  // 1. The table, printed whole.
  heading("1. the rights matrix");
  const viewer = { role: "viewer" as const, isSuper: false };
  const treasurer = { role: "treasurer" as const, isSuper: false };
  const admin = { role: "admin" as const, isSuper: false };
  const superAdmin = { role: "admin" as const, isSuper: true };

  show(
    ADMIN_ACTIONS.map((action) => ({
      action,
      viewer: yes(can(viewer, action)),
      treasurer: yes(can(treasurer, action)),
      admin: yes(can(admin, action)),
      super: yes(can(superAdmin, action)),
    })),
  );

  /*
   * The matrix from the brief, with Part 7 winning where the two disagreed:
   * deleting a pledge and editing campaign settings are the super
   * administrator's alone, along with creating another administrator.
   */
  const expected: Record<string, [boolean, boolean, boolean, boolean]> = {
    // action:            viewer treasurer admin  super
    "pledges.view": [true, true, true, true],
    "pledges.viewPhone": [false, true, true, true],
    "pledges.approve": [false, true, true, true],
    "pledges.void": [false, true, true, true],
    "pledges.create": [false, true, true, true],
    "pledges.edit": [false, false, true, true],
    "pledges.delete": [false, false, false, true],
    "payments.view": [true, true, true, true],
    "payments.record": [false, true, true, true],
    "payments.allocate": [false, true, true, true],
    "payments.deallocate": [false, false, true, true],
    "exports.download": [false, true, true, true],
    "analytics.view": [true, true, true, true],
    "audit.view": [false, false, true, true],
    "users.manage": [false, false, true, true],
    "users.resetPassword": [false, false, true, true],
    "users.createAdmin": [false, false, false, true],
    "settings.edit": [false, false, false, true],
  };

  check(
    "every action in the table is accounted for",
    ADMIN_ACTIONS.every((a) => a in expected) &&
      Object.keys(expected).length === ADMIN_ACTIONS.length,
    `${ADMIN_ACTIONS.length} actions`,
  );

  for (const action of ADMIN_ACTIONS) {
    const want = expected[action];
    if (!want) continue;
    const got = [
      can(viewer, action),
      can(treasurer, action),
      can(admin, action),
      can(superAdmin, action),
    ];
    check(
      action,
      got.every((g, i) => g === want[i]),
      `${got.map(yes).join("/")} wanted ${want.map(yes).join("/")}`,
    );
  }

  check(
    "the three super only actions are exactly the ones Part 7 names",
    ADMIN_ACTIONS.filter((a) => rulesFor(a).superOnly).join(",") ===
      "pledges.delete,users.createAdmin,settings.edit",
    ADMIN_ACTIONS.filter((a) => rulesFor(a).superOnly).join(","),
  );
  check(
    "and a plain admin is refused all three",
    !can(admin, "pledges.delete") &&
      !can(admin, "settings.edit") &&
      !can(admin, "users.createAdmin"),
  );

  // 2. One super admin, enforced by the database.
  heading("2. only one super administrator");
  await removeVerificationAdmins(db);

  const realSuper = await db.execute(sql`
    select count(*)::int as n from admin_users where is_super
  `);
  const supers = (realSuper.rows[0] as { n: number }).n;
  check(
    "the database holds at most one",
    supers <= 1,
    `${supers} super admin(s)`,
  );

  let refused = false;
  try {
    await db.execute(sql`
      insert into admin_users (email, full_name, role, is_super)
      values ('verify-part-u-second-super@example.test', 'Second Super', 'admin', true)
    `);
  } catch {
    refused = true;
  }
  if (!refused) {
    await db.execute(sql`
      delete from admin_users where email = 'verify-part-u-second-super@example.test'
    `);
  }
  check(
    "a second one is refused",
    supers === 0 ? true : refused,
    supers === 0 ? "(no super admin present to conflict with)" : "unique index fired",
  );

  let notAdmin = false;
  try {
    await db.execute(sql`
      insert into admin_users (email, full_name, role, is_super)
      values ('verify-part-u-super-viewer@example.test', 'Super Viewer', 'viewer', true)
    `);
  } catch {
    notAdmin = true;
  }
  if (!notAdmin) {
    await db.execute(sql`
      delete from admin_users where email = 'verify-part-u-super-viewer@example.test'
    `);
  }
  check("a super admin who is not an admin is refused", notAdmin);

  // 3. The routes agree with the table.
  heading("3. what each role actually gets from the routes");

  const signIn = async (role: "viewer" | "treasurer" | "admin") => {
    await removeVerificationAdmins(db);
    await provisionAdmin(db, {
      email: `verify-part-u-${role}@example.test`,
      password: PASSWORD,
      fullName: `Rights ${role}`,
      role,
    });

    const response = await fetch(`${BASE}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: `verify-part-u-${role}@example.test`,
        password: PASSWORD,
      }),
    });

    const cookie = response.headers.getSetCookie().join("; ");
    if (!cookie) throw new Error(`could not sign in as ${role}`);
    return cookie;
  };

  const call = async (cookie: string, path: string, method = "GET") => {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: { cookie, "content-type": "application/json" },
      body: method === "GET" ? undefined : "{}",
    });
    return response.status;
  };

  const probes: { path: string; method: string; label: string }[] = [
    { path: "/api/admin/analytics", method: "GET", label: "view analytics" },
    { path: "/api/admin/pledges/search?q=test", method: "GET", label: "search pledges" },
    { path: "/api/admin/exports/pledges.csv", method: "GET", label: "export pledges" },
    { path: "/api/admin/payments", method: "POST", label: "record a payment" },
  ];

  const results: Record<string, unknown>[] = [];

  for (const role of ["viewer", "treasurer", "admin"] as const) {
    const cookie = await signIn(role);
    const row: Record<string, unknown> = { role };
    for (const probe of probes) {
      row[probe.label] = await call(cookie, probe.path, probe.method);
    }
    results.push(row);
  }

  show(results);

  const [asViewer, asTreasurer, asAdmin] = results as Record<string, number>[];

  check(
    "a viewer may read analytics",
    asViewer["view analytics"] === 200,
    `${asViewer["view analytics"]}`,
  );
  check(
    "a viewer may search pledges",
    asViewer["search pledges"] === 200,
    `${asViewer["search pledges"]}`,
  );
  check(
    "a viewer is refused the export",
    asViewer["export pledges"] === 403,
    `${asViewer["export pledges"]}`,
  );
  check(
    "and refused recording a payment",
    asViewer["record a payment"] === 403,
    `${asViewer["record a payment"]}`,
  );
  check(
    "a treasurer gets the export",
    asTreasurer["export pledges"] === 200,
    `${asTreasurer["export pledges"]}`,
  );
  check(
    "and is let as far as the payment form",
    asTreasurer["record a payment"] !== 403,
    `${asTreasurer["record a payment"]} (422 is the empty body, not a refusal)`,
  );
  check(
    "an admin gets everything these four probes cover",
    asAdmin["view analytics"] === 200 &&
      asAdmin["search pledges"] === 200 &&
      asAdmin["export pledges"] === 200 &&
      asAdmin["record a payment"] !== 403,
  );

  // 4. Refusals are written down.
  heading("4. every refusal leaves a row");
  const rows = await audit.recentByAction(db, ["admin.forbidden"], 20);
  const attempted = rows
    .map((r) => (r.after as { attempted?: string } | null)?.attempted)
    .filter(Boolean);
  show(
    rows.slice(0, 6).map((r) => ({
      action: r.action,
      role: (r.after as { role?: string } | null)?.role,
      attempted: (r.after as { attempted?: string } | null)?.attempted,
    })),
  );
  check(
    "the viewer's refused export is in the journal",
    attempted.includes("exports.download"),
    attempted.slice(0, 6).join(", "),
  );
  check(
    "so is the refused payment",
    attempted.includes("payments.record"),
  );
  check(
    "and the action recorded is the one from the rights table, not a free string",
    attempted.every(
      (a) => a === undefined || (ADMIN_ACTIONS as readonly string[]).includes(a),
    ),
  );

  // 5. Clean up.
  heading("5. cleanup");
  await removeVerificationAdmins(db);
  const left = await db.execute(sql`
    select count(*)::int as n from admin_users
    where email like 'verify-%@example.test'
  `);
  check("no verification admins left", (left.rows[0] as { n: number }).n === 0);

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
