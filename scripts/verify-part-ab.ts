import { config } from "dotenv";

import { provisionAdmin, removeVerificationAdmins } from "./verification-admin";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * The enrolment column on the administrators screen.
 *
 * It used to read admin_users.totp_secret, a column that predates the two
 * factor plugin and that nothing has written since Better Auth arrived. So it
 * was wrong in both directions: an account enrolled through the login screen
 * read as not enrolled, and an account whose enrolment had been deleted by a
 * lockout reset would have read as enrolled, which is exactly the account
 * somebody looking at that screen needs to find.
 *
 * Four accounts are set up here, one for each state the column has to tell
 * apart, and list() is asked what it says about them. No HTTP: this is a
 * service function taking a db handle, so it is called directly.
 *
 * Writes accounts, so never point it at the live database.
 *
 * Usage: pnpm db:verify:totp-badge
 */

const PASSWORD = "correct-horse-battery-staple";

const ENROLLED = "verify-part-ab-enrolled@example.test";
const HALF = "verify-part-ab-half@example.test";
const STALE = "verify-part-ab-stale@example.test";
const LEGACY = "verify-part-ab-legacy@example.test";

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
  const users = await import("@/server/services/admin-users");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(
      `${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`,
    );
  };

  await removeVerificationAdmins(db);

  try {
    heading("four accounts, four states");

    for (const [email, name] of [
      [ENROLLED, "Enrolled"],
      [HALF, "Half enrolled"],
      [STALE, "Reset"],
      [LEGACY, "Legacy secret"],
    ]) {
      await provisionAdmin(db, {
        email,
        password: PASSWORD,
        fullName: name,
        role: "admin",
      });
    }

    /*
     * A finished enrolment: the row Better Auth checks a code against, and the
     * flag it sets once a code has passed. The secret is not a real one and
     * never decrypted here, because nothing under test reads it.
     */
    await db.execute(sql`
      insert into auth_two_factors (id, secret, backup_codes, user_id, verified)
      select 'verify-ab-enrolled', 'not-a-real-secret', 'not-real-codes', id, true
      from auth_users where email = ${ENROLLED}
    `);
    await db.execute(sql`
      update auth_users set two_factor_enabled = true where email = ${ENROLLED}
    `);

    // Enrolment started and never finished. Better Auth refuses this at sign
    // in, so it is not an enrolment.
    await db.execute(sql`
      insert into auth_two_factors (id, secret, backup_codes, user_id, verified)
      select 'verify-ab-half', 'not-a-real-secret', 'not-real-codes', id, false
      from auth_users where email = ${HALF}
    `);

    // What a lockout reset leaves behind: the flag up, the enrolment deleted.
    await db.execute(sql`
      update auth_users set two_factor_enabled = true where email = ${STALE}
    `);

    // The old source of truth, written by nothing since Better Auth arrived.
    await db.execute(sql`
      update admin_users set totp_secret = '\\x00'::bytea where email = ${LEGACY}
    `);

    const raw = (
      await db.execute(sql`
        select a.email,
               a.totp_secret is not null as legacy_secret,
               u.two_factor_enabled as flag,
               count(t.id)::int as enrolments,
               bool_or(t.verified) as verified
        from admin_users a
        join auth_users u on u.id = a.auth_user_id
        left join auth_two_factors t on t.user_id = u.id
        where a.email like 'verify-part-ab-%@example.test'
        group by a.email, a.totp_secret, u.two_factor_enabled
        order by a.email
      `)
    ).rows as Record<string, unknown>[];
    show(raw);

    heading("what the screen is told");

    const listed = await users.list(db);
    const byEmail = new Map(listed.map((row) => [row.email, row]));
    show(
      listed
        .filter((row) => row.email.startsWith("verify-part-ab-"))
        .map((row) => ({
          email: row.email,
          twoFactorEnabled: row.twoFactorEnabled,
        })),
    );

    check(
      "a finished enrolment reads as enrolled",
      byEmail.get(ENROLLED)?.twoFactorEnabled === true,
    );
    check(
      "an unfinished one does not",
      byEmail.get(HALF)?.twoFactorEnabled === false,
    );
    check(
      "and neither does an account whose enrolment was reset away",
      byEmail.get(STALE)?.twoFactorEnabled === false,
    );
    check(
      "the legacy totp_secret column is no longer believed",
      byEmail.get(LEGACY)?.twoFactorEnabled === false,
    );

    heading("and the rest of the row still arrives");

    const one = byEmail.get(ENROLLED);
    show([
      {
        email: one?.email,
        fullName: one?.fullName,
        role: one?.role,
        isActive: one?.isActive,
        isSuper: one?.isSuper,
        mustChangePassword: one?.mustChangePassword,
        createdAt: one?.createdAt?.toISOString(),
      },
    ]);
    check(
      "the aliased query did not drop a column",
      one?.fullName === "Enrolled" &&
        one?.role === "admin" &&
        one?.isActive === true &&
        one?.isSuper === false &&
        one?.createdAt instanceof Date,
    );
  } finally {
    await db.execute(sql`
      delete from auth_two_factors
      where id in ('verify-ab-enrolled', 'verify-ab-half')
    `);
    await removeVerificationAdmins(db);
  }

  heading("afterwards");

  const left = (
    await db.execute(sql`
      select
        (select count(*)::int from admin_users
          where email like 'verify-part-ab-%@example.test') as admins,
        (select count(*)::int from auth_two_factors
          where id like 'verify-ab-%') as enrolments
    `)
  ).rows as { admins: number; enrolments: number }[];
  show(left as unknown as Record<string, unknown>[]);
  check(
    "every fixture is gone",
    left[0]?.admins === 0 && left[0]?.enrolments === 0,
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
