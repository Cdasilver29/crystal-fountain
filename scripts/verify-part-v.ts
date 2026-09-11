import { config } from "dotenv";

import { provisionAdmin, removeVerificationAdmins } from "./verification-admin";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * User management and the portal password reset.
 *
 * Drives the real routes over HTTP as each role in turn, because the questions
 * worth asking here are about who is refused: a treasurer reaching the users
 * screen, an ordinary admin creating another admin, somebody deactivating
 * themselves or the super administrator.
 *
 * The forced password change is the other half. A temporary password is known
 * to whoever generated it, so an account carrying one must be able to do
 * exactly one thing, and this proves it can do that one thing and nothing else.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:users
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
  const {
    generateTemporaryPassword,
    MAX_ADMIN_USERS,
    TEMPORARY_PASSWORD_LENGTH,
  } = await import("@/server/contracts/admin-users");
  const audit = await import("@/server/services/admin-audit");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(
      `${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`,
    );
  };

  const wipe = async () => {
    await removeVerificationAdmins(db);
    await db.execute(sql`
      delete from admin_users where email like 'verify-part-v%@example.test'
    `);
    await db.execute(sql`
      delete from auth_users where email like 'verify-part-v%@example.test'
    `);
  };

  await wipe();

  const signIn = async (email: string, password: string) => {
    const response = await fetch(`${BASE}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    return {
      status: response.status,
      cookie: response.headers.getSetCookie().join("; "),
    };
  };

  const call = async (
    cookie: string,
    path: string,
    init: RequestInit = {},
  ) => {
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

  // 1. The generated password, before anything is written.
  heading("1. temporary passwords");
  const { webcrypto } = await import("node:crypto");
  const sample = Array.from({ length: 200 }, () =>
    generateTemporaryPassword((n) =>
      webcrypto.getRandomValues(new Uint8Array(n)),
    ),
  );
  show([
    { example: sample[0] },
    { example: sample[1] },
    { example: sample[2] },
  ]);
  check(
    `each is ${TEMPORARY_PASSWORD_LENGTH} characters`,
    sample.every((p) => p.length === TEMPORARY_PASSWORD_LENGTH),
  );
  check(
    "no two are alike",
    new Set(sample).size === sample.length,
    `${new Set(sample).size} distinct out of ${sample.length}`,
  );
  check(
    "no ambiguous glyphs, since these get read aloud",
    sample.every((p) => !/[0O1lI]/.test(p)),
  );
  check(
    "and long enough for the minimum the login enforces",
    TEMPORARY_PASSWORD_LENGTH >= 12,
  );

  // 2. Who may open the screen at all.
  heading("2. who may manage users");
  const roles = ["viewer", "treasurer", "admin"] as const;
  const cookies: Record<string, string> = {};

  for (const role of roles) {
    await provisionAdmin(db, {
      email: `verify-part-v-${role}@example.test`,
      password: PASSWORD,
      fullName: `Users ${role}`,
      role,
    });
    const { cookie } = await signIn(
      `verify-part-v-${role}@example.test`,
      PASSWORD,
    );
    cookies[role] = cookie;
  }

  const listResults: Record<string, unknown>[] = [];
  for (const role of roles) {
    const got = await call(cookies[role], "/api/admin/users");
    listResults.push({ role, status: got.status });
  }
  show(listResults);
  check(
    "a viewer is refused",
    (listResults[0] as { status: number }).status === 403,
  );
  check(
    "a treasurer is refused",
    (listResults[1] as { status: number }).status === 403,
  );
  check(
    "an admin gets the list",
    (listResults[2] as { status: number }).status === 200,
  );

  // 3. Creating an administrator is narrower than managing users.
  heading("3. only the super administrator creates an administrator");
  const asAdmin = cookies.admin;

  const madeViewer = await call(asAdmin, "/api/admin/users", {
    method: "POST",
    body: JSON.stringify({
      fullName: "Made Viewer",
      email: "verify-part-v-made@example.test",
      role: "viewer",
    }),
  });
  check(
    "an ordinary admin may create a viewer",
    madeViewer.status === 201,
    `${madeViewer.status}`,
  );
  const issued = String(madeViewer.body?.temporaryPassword ?? "");
  check(
    "and gets a temporary password back exactly once",
    issued.length === TEMPORARY_PASSWORD_LENGTH,
    issued ? `${issued.length} characters` : "(none)",
  );

  const madeAdmin = await call(asAdmin, "/api/admin/users", {
    method: "POST",
    body: JSON.stringify({
      fullName: "Made Admin",
      email: "verify-part-v-admin2@example.test",
      role: "admin",
    }),
  });
  check(
    "but not another administrator",
    madeAdmin.status === 403,
    `${madeAdmin.status}`,
  );

  const stored = await db.execute(sql`
    select count(*)::int as n from admin_users
    where email = 'verify-part-v-admin2@example.test'
  `);
  check(
    "and the refused account was not half created",
    (stored.rows[0] as { n: number }).n === 0,
  );

  // 4. The password is nowhere but that one response.
  heading("4. the temporary password is not written down");
  const leaked = await db.execute(sql`
    select count(*)::int as n from audit_log
    where after::text like ${"%" + issued + "%"}
       or before::text like ${"%" + issued + "%"}
  `);
  check(
    "it is not in the audit log",
    (leaked.rows[0] as { n: number }).n === 0,
  );
  const inAccounts = await db.execute(sql`
    select count(*)::int as n from auth_accounts where password = ${issued}
  `);
  check(
    "and not stored in the clear",
    (inAccounts.rows[0] as { n: number }).n === 0,
  );

  // 5. The forced change.
  heading("5. an account with a temporary password can do one thing");
  const fresh = await signIn("verify-part-v-made@example.test", issued);
  check("the temporary password signs in", fresh.status === 200, `${fresh.status}`);

  const blocked = await call(fresh.cookie, "/api/admin/pledges/search?q=a");
  check(
    "but every other route refuses it",
    blocked.status === 403 &&
      blocked.body?.code === "password_change_required",
    `${blocked.status} ${String(blocked.body?.code)}`,
  );

  const wrongCurrent = await call(fresh.cookie, "/api/admin/change-password", {
    method: "POST",
    body: JSON.stringify({
      currentPassword: "not-the-temporary-one",
      newPassword: "a-perfectly-fine-new-password",
      confirmPassword: "a-perfectly-fine-new-password",
    }),
  });
  check(
    "changing it needs the current one",
    wrongCurrent.status === 422 && wrongCurrent.body?.code === "wrong_password",
    `${wrongCurrent.status} ${String(wrongCurrent.body?.code)}`,
  );

  const changed = await call(fresh.cookie, "/api/admin/change-password", {
    method: "POST",
    body: JSON.stringify({
      currentPassword: issued,
      newPassword: "a-perfectly-fine-new-password",
      confirmPassword: "a-perfectly-fine-new-password",
    }),
  });
  check("with it, the change goes through", changed.status === 200, `${changed.status}`);

  const nowAllowed = await call(fresh.cookie, "/api/admin/pledges/search?q=test");
  check(
    "and the account works normally afterwards",
    nowAllowed.status === 200,
    `${nowAllowed.status}`,
  );

  const flag = await db.execute(sql`
    select force_password_change from admin_users
    where email = 'verify-part-v-made@example.test'
  `);
  check(
    "the forced change flag is cleared",
    (flag.rows[0] as { force_password_change: boolean })
      .force_password_change === false,
  );

  // 6. A reset ends the other person's sessions.
  heading("6. a reset signs them out");
  const target = await db.execute(sql`
    select id from admin_users where email = 'verify-part-v-made@example.test'
  `);
  const targetId = (target.rows[0] as { id: string }).id;

  const reset = await call(asAdmin, `/api/admin/users/${targetId}/password`, {
    method: "POST",
  });
  check("the reset succeeds", reset.status === 200, `${reset.status}`);
  const reissued = String(reset.body?.temporaryPassword ?? "");
  check(
    "with a new temporary password",
    reissued.length === TEMPORARY_PASSWORD_LENGTH && reissued !== issued,
  );

  const afterReset = await call(fresh.cookie, "/api/admin/pledges/search?q=test");
  check(
    "their open session is dead",
    afterReset.status === 401 || afterReset.status === 403,
    `${afterReset.status}`,
  );

  const oldPassword = await signIn(
    "verify-part-v-made@example.test",
    "a-perfectly-fine-new-password",
  );
  check(
    "and their old password no longer works",
    oldPassword.status !== 200,
    `${oldPassword.status}`,
  );

  // 7. What cannot be done to whom.
  heading("7. the accounts that cannot be retired");
  const selfRow = await db.execute(sql`
    select id from admin_users where email = 'verify-part-v-admin@example.test'
  `);
  const selfId = (selfRow.rows[0] as { id: string }).id;

  const selfOff = await call(asAdmin, `/api/admin/users/${selfId}`, {
    method: "DELETE",
  });
  check(
    "you cannot deactivate yourself",
    selfOff.status === 422 && selfOff.body?.code === "self_deactivate",
    `${selfOff.status} ${String(selfOff.body?.code)}`,
  );

  const selfReset = await call(asAdmin, `/api/admin/users/${selfId}/password`, {
    method: "POST",
  });
  check(
    "and you cannot reset your own password this way",
    selfReset.status === 409,
    `${selfReset.status}`,
  );

  // 8. Retiring keeps the row.
  heading("8. retiring an account keeps its history");
  const before = await db.execute(sql`
    select count(*)::int as n from admin_users where id = ${targetId}::uuid
  `);
  const off = await call(asAdmin, `/api/admin/users/${targetId}`, {
    method: "DELETE",
  });
  const after = await db.execute(sql`
    select is_active from admin_users where id = ${targetId}::uuid
  `);
  show([
    {
      rows_before: (before.rows[0] as { n: number }).n,
      delete_status: off.status,
      row_still_there: after.rows.length === 1,
      is_active: (after.rows[0] as { is_active: boolean })?.is_active,
    },
  ]);
  check("the request succeeds", off.status === 200, `${off.status}`);
  check("the row is still there", after.rows.length === 1);
  check(
    "and it is simply inactive",
    (after.rows[0] as { is_active: boolean }).is_active === false,
  );

  const deadSignIn = await signIn(
    "verify-part-v-made@example.test",
    reissued,
  );
  check(
    "a retired account cannot sign in",
    deadSignIn.status !== 200,
    `${deadSignIn.status}`,
  );

  // 9. The cap.
  heading("9. the five account limit");
  const capacityNow = await call(asAdmin, "/api/admin/users");
  const room = capacityNow.body?.capacity as {
    active: number;
    limit: number;
    full: boolean;
  };
  show([room as unknown as Record<string, unknown>]);
  check("the limit is five", room.limit === MAX_ADMIN_USERS);
  check(
    "a retired account does not hold its place",
    room.active === 3,
    `${room.active} active (viewer, treasurer, admin), the retired one excluded`,
  );

  // Fill up to the cap, then try one more.
  const filled: number[] = [];
  for (let i = room.active; i < MAX_ADMIN_USERS; i += 1) {
    const made = await call(asAdmin, "/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        fullName: `Filler ${i}`,
        email: `verify-part-v-fill${i}@example.test`,
        role: "viewer",
      }),
    });
    filled.push(made.status);
  }
  const overflow = await call(asAdmin, "/api/admin/users", {
    method: "POST",
    body: JSON.stringify({
      fullName: "One Too Many",
      email: "verify-part-v-toomany@example.test",
      role: "viewer",
    }),
  });
  check(
    "accounts can be added up to the limit",
    filled.every((s) => s === 201),
    filled.join(", "),
  );
  check(
    "and the sixth is refused",
    overflow.status === 409 && overflow.body?.code === "admin_limit_reached",
    `${overflow.status} ${String(overflow.body?.code)}`,
  );

  // 10. Every change left a row.
  heading("10. the journal");
  const rows = await audit.recentByAction(
    db,
    [
      "admin.created",
      "admin.password_reset",
      "admin.password_changed",
      "admin.deactivated",
    ],
    20,
  );
  const actions = new Set(rows.map((r) => r.action));
  show(
    rows.slice(0, 6).map((r) => ({
      action: r.action,
      email: (r.after as { email?: string } | null)?.email,
    })),
  );
  for (const action of [
    "admin.created",
    "admin.password_reset",
    "admin.password_changed",
    "admin.deactivated",
  ]) {
    check(`${action} is in the journal`, actions.has(action));
  }

  // 11. Clean up.
  heading("11. cleanup");
  await wipe();
  const left = await db.execute(sql`
    select count(*)::int as n from admin_users
    where email like 'verify-%@example.test'
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

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
