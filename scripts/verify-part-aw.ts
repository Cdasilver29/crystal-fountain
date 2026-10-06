import { config } from "dotenv";

import { adminPages, apiHandlers } from "./api-routes";
import { provisionAdmin, removeVerificationAdmins } from "./verification-admin";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Admin protection and response hardening (security Session 3, item 3.3).
 *
 * 1. Every admin API route refuses a caller with no session, with the
 *    x-middleware-subrequest header that once skipped middleware, with a
 *    forged session cookie that gets past the middleware's presence check, and
 *    with both. The forged cookie is the one that matters: it proves each
 *    route checks the session itself rather than trusting the middleware.
 * 2. Every admin page does the same, redirecting to the sign in screen.
 * 3. Every admin page and admin API response sends Cache-Control: no-store,
 *    signed in and signed out, CSV exports included.
 * 4. Deactivating an admin, resetting their password and changing their role
 *    each end that person's live session at once. A name correction does not.
 * 5. No error body from any API route carries a stack trace, SQL, or a table
 *    or column name. Run once more against a server whose database refuses
 *    the connection by setting VERIFY_BROKEN_BASE_URL.
 * 6. The attributes of every cookie the site sets, printed for the report.
 *
 * Routes and pages are found by reading src/app, never from a typed list.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:admin-guards
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const BROKEN = process.env.VERIFY_BROKEN_BASE_URL;
const PASSWORD = "correct-horse-battery-staple";

const BYPASS = [
  "middleware",
  "src/middleware",
  "middleware:middleware:middleware:middleware:middleware",
  "src/middleware:src/middleware:src/middleware:src/middleware:src/middleware",
];

/** Anything an error body must never contain. */
const LEAK =
  /\bat [\w.<>]+ \(|node_modules|\.tsx?:\d+|\bselect\b[\s\S]*\bfrom\b|\binsert into\b|\bupdate \w+ set\b|relation "|column "|violates|postgres|neondb|NeonDbError|drizzle|\b(pledges|pledgers|pledge_increments|payments|payment_allocations|audit_log|admin_users|auth_sessions|auth_users|campaigns)\b\.|ECONNREFUSED|password authentication/i;

function heading(text: string) {
  console.log(`\n== ${text} ==`);
}

async function main() {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const adminUsersService = await import("@/server/services/admin-users");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  };

  const wipe = async () => {
    await removeVerificationAdmins(db);
  };
  await wipe();

  const signIn = async (email: string) => {
    const response = await fetch(`${BASE}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    return {
      status: response.status,
      setCookies: response.headers.getSetCookie(),
      cookie: response.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; "),
    };
  };

  const request = async (
    base: string,
    path: string,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ) => {
    const response = await fetch(`${base}${path}`, { redirect: "manual", ...init });
    const text = await response.text();
    let code: string | undefined;
    try {
      code = (JSON.parse(text) as { code?: string }).code;
    } catch {
      code = undefined;
    }
    return {
      status: response.status,
      code,
      text,
      location: response.headers.get("location"),
      cacheControl: response.headers.get("cache-control") ?? "",
      setCookies: response.headers.getSetCookie(),
    };
  };

  const handlers = apiHandlers();
  const adminApi = handlers.filter((h) => h.path.startsWith("/api/admin/"));
  // Public by design: there is nobody to authenticate as yet, or it is the
  // door itself. Each gates itself and is checked separately below.
  const OPEN = new Set(["/api/admin/login", "/api/admin/setup", "/api/admin/logout"]);
  const guarded = adminApi.filter((h) => !OPEN.has(h.path));

  // 1. Every admin API route checks the session itself.
  heading(`1. ${guarded.length} admin API handlers refuse without a real session`);
  const modes: [string, Record<string, string>][] = [
    ["no session", {}],
    ...BYPASS.map((v): [string, Record<string, string>] => [`bypass ${v.slice(0, 18)}`, { "x-middleware-subrequest": v }]),
    ["forged cookie", { cookie: "admin-session=forged.value; __Secure-admin-session=forged.value" }],
    ["bypass and forged", { "x-middleware-subrequest": BYPASS[2], cookie: "admin-session=forged.value" }],
  ];
  const refusedEverywhere: string[] = [];
  for (const h of guarded) {
    const results: string[] = [];
    for (const [, headers] of modes) {
      const r = await request(BASE, h.path, {
        method: h.method,
        headers: { "content-type": "application/json", ...headers },
        body: h.method === "GET" ? undefined : "{}",
      });
      results.push(String(r.status));
      if (r.status !== 401 && r.status !== 403) {
        check(`${h.method} ${h.path} refuses`, false, `${r.status} ${r.text.slice(0, 80)}`);
      }
    }
    if (results.every((s) => s === "401" || s === "403")) refusedEverywhere.push(`${h.method} ${h.path}`);
  }
  check(
    `all ${guarded.length} handlers refuse in all ${modes.length} modes`,
    refusedEverywhere.length === guarded.length,
    `${refusedEverywhere.length}/${guarded.length}`,
  );

  const login = await request(BASE, "/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-middleware-subrequest": BYPASS[2] },
    body: "{}",
  });
  check("the login route refuses an empty sign in", login.status >= 400 && login.status < 500, `${login.status} ${login.code}`);
  const setup = await request(BASE, "/api/admin/setup", {
    method: "POST",
    headers: { "content-type": "application/json", "x-middleware-subrequest": BYPASS[2] },
    body: "{}",
  });
  check("first run setup is closed once an admin exists", setup.status === 404, `${setup.status}`);

  // 2. Every admin page.
  const pages = adminPages();
  const gatedPages = pages.filter((p) => p !== "/admin/login" && p !== "/admin/setup");
  heading(`2. ${gatedPages.length} admin pages send a stranger to sign in`);
  for (const page of gatedPages) {
    const outcomes: string[] = [];
    let ok = true;
    for (const [, headers] of modes) {
      const r = await request(BASE, page, { headers });
      outcomes.push(String(r.status));
      const toLogin = (r.status === 307 || r.status === 308) && (r.location ?? "").includes("/admin/login");
      if (!toLogin && r.status !== 401 && r.status !== 403 && r.status !== 404) ok = false;
    }
    check(`${page}`, ok, outcomes.join(" "));
  }
  const setupPage = await request(BASE, "/admin/setup");
  check("/admin/setup is a 404 once an admin exists", setupPage.status === 404, `${setupPage.status}`);

  // 3. No admin response is cached.
  heading("3. no-store on every admin page and admin API response");
  await provisionAdmin(db, {
    email: "verify-part-aw-admin@example.test",
    password: PASSWORD,
    fullName: "Guard Admin",
    role: "admin",
  });
  const admin = await signIn("verify-part-aw-admin@example.test");
  check("the verification admin signs in", admin.status === 200, `${admin.status}`);

  const notStored: string[] = [];
  for (const page of pages) {
    for (const cookie of ["", admin.cookie]) {
      const r = await request(BASE, page, { headers: cookie ? { cookie } : {} });
      if (!/\bno-store\b/.test(r.cacheControl)) notStored.push(`${page} ${cookie ? "signed in" : "signed out"} ${r.status} "${r.cacheControl}"`);
    }
  }
  for (const h of adminApi.filter((x) => x.method === "GET")) {
    const query = h.path.endsWith("/search") ? "?q=test" : "";
    for (const cookie of ["", admin.cookie]) {
      const r = await request(BASE, `${h.path}${query}`, { headers: cookie ? { cookie } : {} });
      if (!/\bno-store\b/.test(r.cacheControl)) notStored.push(`GET ${h.path} ${cookie ? "signed in" : "signed out"} ${r.status} "${r.cacheControl}"`);
    }
  }
  for (const h of adminApi.filter((x) => x.method !== "GET" && !OPEN.has(x.path))) {
    const r = await request(BASE, h.path, {
      method: h.method,
      headers: { "content-type": "application/json", cookie: admin.cookie },
      body: "{}",
    });
    if (!/\bno-store\b/.test(r.cacheControl)) notStored.push(`${h.method} ${h.path} ${r.status} "${r.cacheControl}"`);
  }
  for (const line of notStored) console.log("   missing:", line);
  check("every admin response says no-store", notStored.length === 0, `${notStored.length} missing`);
  const csv = await request(BASE, "/api/admin/exports/pledges.csv", { headers: { cookie: admin.cookie } });
  check("including the pledge CSV export", csv.status === 200 && /\bno-store\b/.test(csv.cacheControl), `${csv.status} "${csv.cacheControl}"`);

  // 4. Ending sessions.
  heading("4. deactivation, password reset and role change end live sessions");
  const adminRow = await db.execute(sql`select id from admin_users where email = 'verify-part-aw-admin@example.test'`);
  const adminId = String((adminRow.rows[0] as { id: string }).id);

  const targets = ["deactivated", "reset", "promoted", "renamed"] as const;
  const session: Record<string, { id: string; cookie: string }> = {};
  for (const t of targets) {
    const made = await provisionAdmin(db, {
      email: `verify-part-aw-${t}@example.test`,
      password: PASSWORD,
      fullName: `Target ${t}`,
      role: "viewer",
    });
    const s = await signIn(`verify-part-aw-${t}@example.test`);
    session[t] = { id: made.adminUserId, cookie: s.cookie };
    const alive = await request(BASE, "/api/admin/analytics", { headers: { cookie: s.cookie } });
    check(`${t}: signed in and working before`, alive.status === 200, `${alive.status}`);
  }

  const off = await request(BASE, `/api/admin/users/${session.deactivated.id}`, {
    method: "DELETE",
    headers: { cookie: admin.cookie },
  });
  check("deactivation succeeds", off.status === 200, `${off.status} ${off.code ?? ""}`);

  const reset = await request(BASE, `/api/admin/users/${session.reset.id}/password`, {
    method: "POST",
    headers: { cookie: admin.cookie },
  });
  check("password reset succeeds", reset.status === 200, `${reset.status} ${reset.code ?? ""}`);

  // A role change is the super administrator's alone, and the only one is a
  // real person this suite cannot sign in as, so it calls the service the
  // route calls, with the permission the route would pass.
  await adminUsersService.update(db, {
    adminUserId: session.promoted.id,
    input: { role: "treasurer" },
    actorId: adminId,
    mayChangeRole: true,
  });
  await adminUsersService.update(db, {
    adminUserId: session.renamed.id,
    input: { fullName: "Target Renamed Correctly" },
    actorId: adminId,
    mayChangeRole: false,
  });

  for (const t of ["deactivated", "reset", "promoted"] as const) {
    const after = await request(BASE, "/api/admin/analytics", { headers: { cookie: session[t].cookie } });
    check(`${t}: their open session is dead`, after.status === 401, `${after.status}`);
    const rows = await db.execute(sql`
      select count(*)::int as n from auth_sessions s
      join admin_users a on a.auth_user_id = s.user_id
      where a.id = ${session[t].id}::uuid
    `);
    check(`${t}: no session rows left`, (rows.rows[0] as { n: number }).n === 0);
  }
  const renamed = await request(BASE, "/api/admin/analytics", { headers: { cookie: session.renamed.cookie } });
  check("a name correction alone signs nobody out", renamed.status === 200, `${renamed.status}`);

  const journal = await db.execute(sql`
    select after from audit_log
    where action = 'admin.updated' and entity_id = ${session.promoted.id}
    order by at desc limit 1
  `);
  const after = (journal.rows[0] as { after: Record<string, unknown> } | undefined)?.after ?? {};
  check("the role change is journalled with sessions ended", after.role === "treasurer" && after.sessionsEnded === true, JSON.stringify(after));

  // 5. Error bodies.
  const probeErrors = async (base: string, label: string) => {
    heading(`5. no API error leaks internals (${label})`);
    const leaks: string[] = [];
    let probed = 0;
    for (const h of handlers) {
      if (h.path.startsWith("/api/auth/") || h.path.startsWith("/api/cron/")) continue;
      const variants: { headers: Record<string, string>; body?: string }[] =
        h.method === "GET"
          ? [{ headers: {} }, { headers: { cookie: admin.cookie } }]
          : [
              { headers: { "content-type": "application/json" }, body: "{not json" },
              { headers: { "content-type": "application/json" }, body: '{"amount":"x","phone":[1],"id":"nope"}' },
              { headers: { "content-type": "application/json", cookie: admin.cookie }, body: "{not json" },
              { headers: { "content-type": "application/json", cookie: admin.cookie }, body: '{"amountMinor":-1,"pledgeId":"nope"}' },
            ];
      for (const v of variants) {
        // Never sign the verification admin out mid run.
        if (h.path === "/api/admin/logout" && v.headers.cookie) continue;
        const r = await request(base, h.path, { method: h.method, headers: v.headers, body: v.body });
        probed += 1;
        if (r.status >= 400 && LEAK.test(r.text)) {
          leaks.push(`${h.method} ${h.path} ${r.status}: ${r.text.slice(0, 160).replace(/\s+/g, " ")}`);
        }
        if (r.status >= 500 && !r.code) {
          leaks.push(`${h.method} ${h.path} ${r.status} without a code: ${r.text.slice(0, 80).replace(/\s+/g, " ") || "(empty body)"}`);
        }
      }
    }
    for (const line of leaks) console.log("   ", line);
    check(`${label}: ${probed} error probes, no internals and every 500 has a code`, leaks.length === 0, `${leaks.length} problem(s)`);
  };
  await probeErrors(BASE, "working database");
  if (BROKEN) await probeErrors(BROKEN, "database refusing connections");
  else console.log("skip  VERIFY_BROKEN_BASE_URL not set, broken database pass not run");

  // 6. Cookies.
  heading("6. every cookie the site sets");
  const cookieLines = new Map<string, string>();
  const record = (where: string, list: string[]) => {
    for (const c of list) {
      const [pair, ...attrs] = c.split(";").map((p) => p.trim());
      const name = pair.split("=")[0];
      cookieLines.set(`${name} (${where})`, attrs.filter((a) => !/^expires=/i.test(a)).join("; "));
    }
  };
  record("admin sign in", admin.setCookies);
  const google = await request(BASE, "/api/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ provider: "google", callbackURL: "/admin" }),
  });
  record("Google sign in start", google.setCookies);
  const logout = await request(BASE, "/api/admin/logout", { method: "POST", headers: { cookie: admin.cookie } });
  record("sign out", logout.setCookies);
  const { ownerSetCookie } = await import("@/lib/owner-cookie");
  const owner = ownerSetCookie([], "x".repeat(32));
  if (owner) record("pledge (from ownerSetCookie)", [owner]);
  for (const [name, attrs] of cookieLines) console.log(`   ${name}: ${attrs}`);
  check("a sign in sets the session cookie HttpOnly and SameSite=Lax", admin.setCookies.some((c) => /^admin-session=/.test(c) && /HttpOnly/i.test(c) && /SameSite=Lax/i.test(c)));

  // 7. Clean up.
  heading("7. cleanup");
  await wipe();
  const left = await db.execute(sql`select count(*)::int as n from admin_users where email::text like 'verify-part-aw%'`);
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
