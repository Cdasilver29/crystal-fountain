import { createHmac } from "node:crypto";

import { config } from "dotenv";

import { provisionAdmin, removeVerificationAdmins } from "./verification-admin";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Two factor recovery after an enrolment is deleted.
 *
 * A lockout reset deletes the row in auth_two_factors by hand and leaves
 * auth_users.two_factor_enabled behind. That combination used to lock the
 * account out for good: sign in saw the flag and asked for a code, and the
 * code was checked against a secret that no longer existed, so every attempt
 * came back "TOTP not enabled" and the enrolment screen was never offered.
 *
 * What is checked here is the whole path, in the order a person walks it:
 * a first login with nothing enrolled, an ordinary login with a working
 * second factor, the same login after the enrolment has been deleted, and the
 * verify endpoint hit with no enrolment behind it.
 *
 * Writes accounts, so it must not be pointed at the live database. It refuses
 * to start unless the server answers from the same database it is connected
 * to, which is the cheapest proof that both are on the branch.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:totp-recovery
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const EMAIL = "verify-part-aa@example.test";
const PASSWORD = "correct-horse-battery-staple";

/** Better Auth's own limiter allows three two factor calls every ten seconds. */
const TWO_FACTOR_WINDOW_MS = 11_000;

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

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The name=value pairs a browser would keep, and none of the attributes. */
function jar(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    // An expired cookie is sent as an empty value. A browser drops it.
    .filter((pair) => pair.slice(pair.indexOf("=") + 1).length > 0)
    .join("; ");
}

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const character of input.replace(/=+$/, "").toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index === -1) throw new Error(`not base32: ${character}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * The six digits an authenticator app would be showing.
 *
 * Plain RFC 6238 against the secret in the otpauth URI, matched to the plugin
 * options in lib/auth.ts: six digits, thirty second period, SHA-1.
 */
function totpCode(otpauthUri: string): string {
  const secretParam = new URL(otpauthUri).searchParams.get("secret");
  if (!secretParam) throw new Error("no secret in the otpauth URI");

  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));

  const digest = createHmac("sha1", base32Decode(secretParam))
    .update(counter)
    .digest();
  const offset = digest[digest.length - 1] & 15;
  const code =
    ((digest[offset] & 127) << 24) |
    ((digest[offset + 1] & 255) << 16) |
    ((digest[offset + 2] & 255) << 8) |
    (digest[offset + 3] & 255);

  return (code % 1_000_000).toString().padStart(6, "0");
}

async function main() {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(
      `${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`,
    );
  };

  heading("which database");

  const host = process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "";
  console.log(`script: ${host}`);

  const [campaign] = (
    await db.execute(sql`
      select slug, target_minor from campaigns where slug = 'crystal-fountain'
    `)
  ).rows as { slug: string; target_minor: string }[];

  const summary = await fetch(`${BASE}/api/campaign/summary`, {
    cache: "no-store",
  });
  const served = (await summary.json()) as { targetMinor?: string };

  show([
    {
      campaign: campaign?.slug,
      inDatabase: campaign?.target_minor,
      servedByTheApp: served.targetMinor,
    },
  ]);

  /*
   * Not a formality. Without it the script could be writing accounts on a
   * branch while the server it is driving answers from the live database, and
   * every check below would read the wrong one.
   */
  if (String(served.targetMinor) !== String(campaign?.target_minor)) {
    console.error(
      "\nThe server is not answering from the database this script is connected to.",
    );
    console.error("Point both at the same branch and run it again.");
    process.exit(1);
  }

  const twoFactorState = async () => {
    const rows = (
      await db.execute(sql`
        select u.two_factor_enabled as flag,
               count(t.id)::int as enrolments,
               bool_or(t.verified) as verified
        from auth_users u
        left join auth_two_factors t on t.user_id = u.id
        where u.email = ${EMAIL}
        group by u.two_factor_enabled
      `)
    ).rows as { flag: boolean; enrolments: number; verified: boolean | null }[];

    return rows[0] ?? { flag: false, enrolments: 0, verified: null };
  };

  const login = async () => {
    const response = await fetch(`${BASE}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const body = (await response.json().catch(() => null)) as {
      twoFactorRedirect?: boolean;
      twoFactorMethods?: string[];
    } | null;
    const cookies = jar(response);

    return {
      status: response.status,
      body,
      cookies,
      session: cookies.includes("admin-session="),
    };
  };

  let twoFactorCalls = 0;

  const twoFactorCall = async (
    path: string,
    cookies: string,
    payload: Record<string, unknown>,
  ) => {
    if (twoFactorCalls > 0) await pause(TWO_FACTOR_WINDOW_MS);
    twoFactorCalls += 1;

    const response = await fetch(`${BASE}/api/auth/two-factor/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookies },
      body: JSON.stringify(payload),
    });
    const body = (await response.json().catch(() => null)) as {
      totpURI?: string;
      backupCodes?: string[];
      code?: string;
      message?: string;
    } | null;

    return { status: response.status, body, cookies: jar(response) };
  };

  await removeVerificationAdmins(db);

  await provisionAdmin(db, {
    email: EMAIL,
    password: PASSWORD,
    fullName: "Two factor recovery",
    role: "admin",
  });

  try {
    heading("a first login, with nothing enrolled");

    const first = await login();
    check(
      "the password stage signs the account in",
      first.status === 200 && first.session,
      `status ${first.status}`,
    );
    check(
      "and does not ask for a code it has no secret for",
      first.body?.twoFactorRedirect !== true,
    );

    const enrol = await twoFactorCall("enable", first.cookies, {
      password: PASSWORD,
      method: "totp",
    });
    check(
      "enrolment offers a QR and backup codes",
      enrol.status === 200 &&
        (enrol.body?.totpURI ?? "").startsWith("otpauth://totp/") &&
        (enrol.body?.backupCodes?.length ?? 0) > 0,
      `status ${enrol.status}, ${enrol.body?.backupCodes?.length ?? 0} codes`,
    );

    const uri = enrol.body?.totpURI ?? "";
    const verified = await twoFactorCall(
      "verify-totp",
      [first.cookies, enrol.cookies].filter(Boolean).join("; "),
      { code: totpCode(uri) },
    );
    const afterEnrol = await twoFactorState();
    show([afterEnrol as unknown as Record<string, unknown>]);
    check(
      "the code from that QR finishes enrolment",
      verified.status === 200 &&
        afterEnrol.flag === true &&
        afterEnrol.enrolments === 1 &&
        afterEnrol.verified === true,
      `status ${verified.status}`,
    );

    heading("an ordinary login, with the second factor in place");

    const enrolled = await login();
    check(
      "the account is sent to the code screen",
      enrolled.status === 200 && enrolled.body?.twoFactorRedirect === true,
      `status ${enrolled.status}`,
    );
    check(
      "and the answer says totp is what it can be asked for",
      enrolled.body?.twoFactorMethods?.includes("totp") === true,
      JSON.stringify(enrolled.body?.twoFactorMethods ?? []),
    );
    check(
      "no session until the code passes",
      enrolled.session === false,
    );

    heading("after a lockout reset deletes the enrolment");

    await db.execute(sql`
      delete from auth_two_factors
      where user_id = (select id from auth_users where email = ${EMAIL})
    `);

    const broken = await twoFactorState();
    show([broken as unknown as Record<string, unknown>]);
    check(
      "the reset leaves the flag up with nothing behind it",
      broken.flag === true && broken.enrolments === 0,
    );

    const recovered = await login();
    check(
      "logging in now returns a session instead of a code prompt",
      recovered.status === 200 &&
        recovered.session &&
        recovered.body?.twoFactorRedirect !== true,
      `status ${recovered.status}, redirect ${String(recovered.body?.twoFactorRedirect)}`,
    );

    const repaired = await twoFactorState();
    check(
      "and the stale flag is down",
      repaired.flag === false,
      `two_factor_enabled ${String(repaired.flag)}`,
    );

    const audit = (
      await db.execute(sql`
        select actor_type, action, after->>'email' as email
        from audit_log
        where action = 'admin.totp_enrolment_reset'
          and after->>'email' = ${EMAIL}
        order by at desc
        limit 5
      `)
    ).rows as Record<string, unknown>[];
    show(audit);
    check(
      "the repair is in the journal",
      audit.length === 1 && audit[0].actor_type === "system",
      `${audit.length} row(s)`,
    );

    const again = await twoFactorCall("enable", recovered.cookies, {
      password: PASSWORD,
      method: "totp",
    });
    check(
      "the enrolment screen is offered again, with a fresh QR",
      again.status === 200 &&
        (again.body?.totpURI ?? "").startsWith("otpauth://totp/") &&
        (again.body?.backupCodes?.length ?? 0) > 0,
      `status ${again.status}`,
    );
    check(
      "and the new secret is not the old one",
      (again.body?.totpURI ?? "") !== uri,
    );

    heading("the verify endpoint with no enrolment behind it");

    /*
     * Back to a working second factor, so the code screen can be reached the
     * way a person reaches it, and the enrolment is then pulled out from under
     * them: a reset landing between the password and the code.
     */
    await db.execute(sql`
      update auth_two_factors set verified = true
      where user_id = (select id from auth_users where email = ${EMAIL})
    `);
    await db.execute(sql`
      update auth_users set two_factor_enabled = true where email = ${EMAIL}
    `);

    const challenged = await login();
    check(
      "the code screen is reached",
      challenged.body?.twoFactorRedirect === true,
      `status ${challenged.status}`,
    );

    await db.execute(sql`
      delete from auth_two_factors
      where user_id = (select id from auth_users where email = ${EMAIL})
    `);

    const deadEnd = await twoFactorCall("verify-totp", challenged.cookies, {
      code: "000000",
    });
    check(
      "the endpoint still refuses, and says why",
      deadEnd.status === 400 && deadEnd.body?.code === "TOTP_NOT_ENABLED",
      `status ${deadEnd.status}, code ${deadEnd.body?.code ?? "(none)"}`,
    );

    // What the form does with that refusal: the password again, which repairs
    // the account on the way through.
    const fromDeadEnd = await login();
    check(
      "the password stage is the way out of it",
      fromDeadEnd.status === 200 &&
        fromDeadEnd.session &&
        fromDeadEnd.body?.twoFactorRedirect !== true,
      `status ${fromDeadEnd.status}`,
    );

    const last = await twoFactorCall("enable", fromDeadEnd.cookies, {
      password: PASSWORD,
      method: "totp",
    });
    check(
      "and it lands on the enrolment QR, not on the code field",
      last.status === 200 &&
        (last.body?.totpURI ?? "").startsWith("otpauth://totp/"),
      `status ${last.status}`,
    );
  } finally {
    await removeVerificationAdmins(db);
  }

  heading("afterwards");

  const left = (
    await db.execute(sql`
      select count(*)::int as n from auth_users where email = ${EMAIL}
    `)
  ).rows as { n: number }[];
  check("the verification account is gone", left[0]?.n === 0);

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
