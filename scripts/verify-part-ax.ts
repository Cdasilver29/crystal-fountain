import { config } from "dotenv";

import { apiHandlers } from "./api-routes";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Origin checks on every state changing route (security Session 3, item 3.4).
 *
 * Every POST, PATCH, PUT and DELETE under src/app/api, found by reading the
 * files, is sent:
 *
 * - from each of the site's two addresses, which must get past the check
 *   (whatever the route then says, it is not cross_site_refused);
 * - from a foreign origin, a lookalike, the parent church domain and the
 *   literal "null" origin, each refused with cross_site_refused;
 * - with Sec-Fetch-Site: cross-site and no Origin at all, also refused.
 *
 * Better Auth's routes and the cron route keep their own checks and are not
 * swept; Better Auth's own refusal of a foreign origin is shown for the record.
 *
 * Admin routes are sent a forged session cookie. A cross site attack rides on
 * the victim's cookie, so that is the case that matters, and it gets the
 * request past the middleware's presence check to the route, where the origin
 * check runs first. A request that passes it is then refused by the route for
 * having no real session or no valid body, so nothing is written.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:origins
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";

const OURS = ["https://development.newlifesdanairobi.org", "https://crystal-fountain.vercel.app"];
const FOREIGN = [
  "https://evil.example",
  "https://crystal-fountain.vercel.app.evil.example",
  "https://newlifesdanairobi.org",
  "null",
];

function heading(text: string) {
  console.log(`\n== ${text} ==`);
}

async function main() {
  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  };

  const send = async (method: string, path: string, headers: Record<string, string>) => {
    const forged: Record<string, string> = path.startsWith("/api/admin/")
      ? { cookie: "admin-session=forged.value" }
      : {};
    const response = await fetch(`${BASE}${path}`, {
      method,
      redirect: "manual",
      headers: { "content-type": "application/json", ...forged, ...headers },
      body: "{}",
    });
    const text = await response.text();
    let code: string | undefined;
    try {
      code = (JSON.parse(text) as { code?: string }).code;
    } catch {
      code = undefined;
    }
    return { status: response.status, code };
  };

  const writes = apiHandlers().filter(
    (h) => h.method !== "GET" && !h.path.startsWith("/api/auth/") && !h.path.startsWith("/api/cron/"),
  );

  heading(`${writes.length} state changing handlers`);
  check("the sweep found every handler", writes.length >= 26, `${writes.length}`);

  const rows: Record<string, string>[] = [];
  for (const h of writes) {
    const row: Record<string, string> = { route: `${h.method} ${h.path.replace(/0{8}-0{4}-4000-8000-0{12}/g, ":id")}` };
    let ok = true;

    for (const origin of OURS) {
      const r = await send(h.method, h.path, { origin, "sec-fetch-site": "same-origin" });
      row[new URL(origin).hostname.split(".")[0]] = `${r.status} ${r.code ?? ""}`.trim();
      if (r.code === "cross_site_refused") ok = false;
    }
    let foreignRefused = 0;
    for (const origin of FOREIGN) {
      const r = await send(h.method, h.path, { origin });
      if (r.status === 403 && r.code === "cross_site_refused") foreignRefused += 1;
    }
    row.foreign = `${foreignRefused}/${FOREIGN.length} refused`;
    if (foreignRefused !== FOREIGN.length) ok = false;

    const crossSite = await send(h.method, h.path, { "sec-fetch-site": "cross-site" });
    row.crossSite = `${crossSite.status} ${crossSite.code ?? ""}`.trim();
    if (crossSite.code !== "cross_site_refused") ok = false;

    rows.push(row);
    if (!ok) check(row.route, false, JSON.stringify(row));
  }
  console.table(rows);
  check(
    "both addresses accepted, foreign origins and cross-site fetches refused, on every handler",
    !failures.some((f) => f.startsWith("POST") || f.startsWith("PATCH") || f.startsWith("DELETE") || f.startsWith("PUT")),
  );

  heading("left to their own checks");
  const betterAuth = await send("POST", "/api/auth/sign-in/email", { origin: "https://evil.example", cookie: "x=1" });
  console.log(`   Better Auth sign in from a foreign origin: ${betterAuth.status} ${betterAuth.code ?? ""}`);
  check("Better Auth refuses a foreign origin by itself", betterAuth.status === 403, `${betterAuth.status}`);

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
