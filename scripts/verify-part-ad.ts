import { config } from "dotenv";

import { provisionAdmin, removeVerificationAdmins } from "./verification-admin";

/*
 * Captured before dotenv, for the same reason as the G2 suite: .env.local on
 * the development machine holds the live connection string and this script
 * writes accounts.
 */
const explicitDatabaseUrl = process.env.DATABASE_URL;

config({ path: ".env.local" });

/**
 * Account linking, and what the administrators screen says about it.
 *
 * The question is what an account looks like once it has both a password and
 * Google: one Better Auth user with two credentials, or two users and a
 * treasurer who cannot understand why half their sign ins land somewhere else.
 *
 * The linking itself is Better Auth's behaviour and needs a real OAuth round
 * trip to prove, which happens in the browser rather than here. What this
 * asserts is the structure that round trip has to produce, and everything
 * built on top of it: what list() says about each shape of account, when the
 * single method warning appears, and the rule about taking a method away.
 *
 * Writes accounts, so point DATABASE_URL at a Neon branch.
 *
 * Usage:
 *   $env:DATABASE_URL="<branch connection string>"; pnpm db:verify:linking
 */

const PASSWORD = "correct-horse-battery-staple";

const BOTH = "verify-part-ad-both@example.test";
const PASSWORD_ONLY = "verify-part-ad-password@example.test";
const GOOGLE_ONLY = "verify-part-ad-google@example.test";
const PASSWORD_TOTP = "verify-part-ad-password-totp@example.test";
const NOTHING = "verify-part-ad-nothing@example.test";

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
  if (!explicitDatabaseUrl) {
    console.error(
      [
        "Refusing to run.",
        "",
        "DATABASE_URL was not set in the environment, so this would fall back to",
        ".env.local, which on the development machine points at the live database.",
        "This script writes administrator accounts.",
        "",
        'Point it at a Neon branch:  $env:DATABASE_URL="<branch url>"; pnpm db:verify:linking',
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const users = await import("@/server/services/admin-users");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(
      `${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`,
    );
  };

  const target = (
    await db.execute(sql`
      select current_database() as db,
             (select count(*)::int from admin_users) as admins,
             (select count(*)::int from pledges) as pledges
    `)
  ).rows as Record<string, unknown>[];

  heading("the database this is writing to");
  show(target);

  await removeVerificationAdmins(db);

  try {
    heading("the rule, before anything touches a database");

    /*
     * A truth table rather than a handful of examples, so a change to the rule
     * has to come here and be argued with rather than quietly pass.
     *
     * single is "one way in and no backup codes". Two methods is never single.
     * One method plus TOTP is not single either, because enrolment hands out
     * backup codes.
     */
    const cases = [
      { has_password: true, has_google: true, has_totp: true, single: false },
      { has_password: true, has_google: true, has_totp: false, single: false },
      { has_password: true, has_google: false, has_totp: true, single: false },
      { has_password: true, has_google: false, has_totp: false, single: true },
      { has_password: false, has_google: true, has_totp: true, single: false },
      { has_password: false, has_google: true, has_totp: false, single: true },
      { has_password: false, has_google: false, has_totp: true, single: false },
      { has_password: false, has_google: false, has_totp: false, single: true },
    ];

    for (const shape of cases) {
      const label = `${shape.has_password ? "password" : "-"}/${shape.has_google ? "google" : "-"}/${shape.has_totp ? "totp" : "-"}`;
      check(
        `single method is ${shape.single} for ${label}`,
        users.isSingleMethod(shape) === shape.single,
      );
    }

    check(
      "a method can be taken away only when there is another one",
      users.canRemoveSignInMethod({ has_password: true, has_google: true }) ===
        true &&
        users.canRemoveSignInMethod({
          has_password: true,
          has_google: false,
        }) === false &&
        users.canRemoveSignInMethod({
          has_password: false,
          has_google: true,
        }) === false &&
        users.canRemoveSignInMethod({
          has_password: false,
          has_google: false,
        }) === false,
    );

    heading("five accounts, five shapes");

    const both = await provisionAdmin(db, {
      email: BOTH,
      password: PASSWORD,
      fullName: "Both Methods",
      role: "treasurer",
    });
    await provisionAdmin(db, {
      email: PASSWORD_ONLY,
      password: PASSWORD,
      fullName: "Password Only",
      role: "treasurer",
    });
    const googleOnly = await provisionAdmin(db, {
      email: GOOGLE_ONLY,
      password: PASSWORD,
      fullName: "Google Only",
      role: "viewer",
    });
    const passwordTotp = await provisionAdmin(db, {
      email: PASSWORD_TOTP,
      password: PASSWORD,
      fullName: "Password And Totp",
      role: "treasurer",
    });
    await provisionAdmin(db, {
      email: NOTHING,
      password: PASSWORD,
      fullName: "No Credential",
      role: "viewer",
    });

    /*
     * This is the structure the real Google round trip has to produce: the
     * credential row stays exactly where it is and a second row appears beside
     * it on the same user. Built here by hand so the display and the rule can
     * be tested without a browser, and checked against the real thing
     * separately.
     */
    await db.execute(sql`
      insert into auth_accounts (id, account_id, provider_id, user_id)
      values (${`verify-ad-g-${both.authUserId}`}, ${both.authUserId}, 'google', ${both.authUserId})
    `);

    // Google only: the credential goes, the google row arrives.
    await db.execute(sql`
      delete from auth_accounts
      where user_id = ${googleOnly.authUserId} and provider_id = 'credential'
    `);
    await db.execute(sql`
      insert into auth_accounts (id, account_id, provider_id, user_id)
      values (${`verify-ad-g-${googleOnly.authUserId}`}, ${googleOnly.authUserId}, 'google', ${googleOnly.authUserId})
    `);

    await db.execute(sql`
      insert into auth_two_factors (id, user_id, secret, backup_codes, verified)
      values (${`verify-ad-2fa-${passwordTotp.authUserId}`}, ${passwordTotp.authUserId}, 'not-a-real-secret', '[]', true)
    `);

    // Nothing at all: no credential behind the row yet.
    await db.execute(sql`
      update admin_users set auth_user_id = null where email = ${NOTHING}
    `);

    const listed = await users.list(db);
    const byEmail = new Map(listed.map((row) => [row.email, row]));

    show(
      listed
        .filter((row) => row.email.startsWith("verify-part-ad-"))
        .map((row) => ({
          email: row.email,
          password: row.hasPassword,
          google: row.hasGoogle,
          totp: row.twoFactorEnabled,
          single: row.singleMethod,
        })),
    );

    check(
      "an account with both reads as both",
      byEmail.get(BOTH)?.hasPassword === true &&
        byEmail.get(BOTH)?.hasGoogle === true,
    );
    check(
      "and is not flagged single",
      byEmail.get(BOTH)?.singleMethod === false,
    );

    check(
      "a password only account reads as password only",
      byEmail.get(PASSWORD_ONLY)?.hasPassword === true &&
        byEmail.get(PASSWORD_ONLY)?.hasGoogle === false,
    );
    check(
      "and is flagged single, having no backup codes either",
      byEmail.get(PASSWORD_ONLY)?.singleMethod === true,
    );

    check(
      "a google only account reads as google only",
      byEmail.get(GOOGLE_ONLY)?.hasPassword === false &&
        byEmail.get(GOOGLE_ONLY)?.hasGoogle === true,
    );
    check(
      "and is flagged single too",
      byEmail.get(GOOGLE_ONLY)?.singleMethod === true,
    );

    check(
      "one method plus an enrolment is not single",
      byEmail.get(PASSWORD_TOTP)?.singleMethod === false,
      "backup codes are the second way in",
    );

    check(
      "a row with no credential behind it claims no method",
      byEmail.get(NOTHING)?.hasPassword === false &&
        byEmail.get(NOTHING)?.hasGoogle === false,
    );

    heading("a credential row with no hash is not a password");

    /*
     * The trap this guards. Better Auth can leave a credential row whose
     * password is null, and reading provider_id alone would put a Password
     * badge on an account that cannot sign in with one, and worse, would clear
     * the single method warning on exactly the account that needs it.
     */
    await db.execute(sql`
      update auth_accounts set password = null
      where user_id = ${both.authUserId} and provider_id = 'credential'
    `);

    const afterNulling = (await users.list(db)).find(
      (row) => row.email === BOTH,
    );

    check(
      "a null hash does not count as a password",
      afterNulling?.hasPassword === false,
    );
    check(
      "and the account still has google",
      afterNulling?.hasGoogle === true,
    );
    check(
      "so it is now down to one method and flagged single",
      afterNulling?.singleMethod === true,
    );

    heading("what the structure looks like in SQL");

    const structure = (
      await db.execute(sql`
        select a.email,
               count(distinct u.id)::int as auth_users,
               count(distinct c.id)::int as accounts,
               string_agg(distinct c.provider_id, ', ' order by c.provider_id) as providers,
               (a.auth_user_id = max(u.id)) as link_matches
        from admin_users a
        left join auth_users u on u.id = a.auth_user_id
        left join auth_accounts c on c.user_id = u.id
        where a.email like 'verify-part-ad-%@example.test'
        group by a.email, a.auth_user_id
        order by a.email
      `)
    ).rows as Record<string, unknown>[];

    show(structure);

    check(
      "every account resolves to at most one auth_users row",
      structure.every((row) => Number(row.auth_users) <= 1),
    );
    check(
      "the account with both has two credential rows on that one user",
      Number(structure.find((r) => r.email === BOTH)?.accounts) === 2,
      String(structure.find((r) => r.email === BOTH)?.providers),
    );
    check(
      "and admin_users.auth_user_id points at it",
      structure.find((r) => r.email === BOTH)?.link_matches === true,
    );

    heading(failures.length === 0 ? "all checks passed" : "failures");
    if (failures.length > 0) {
      failures.forEach((f) => console.log(`  ${f}`));
      process.exitCode = 1;
    }
  } finally {
    await removeVerificationAdmins(db);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
