import { config } from "dotenv";

import { provisionAdmin, removeVerificationAdmins } from "./verification-admin";

/*
 * Whether the operator pointed this at a database on purpose, captured before
 * dotenv runs.
 *
 * .env.local on the development machine holds the live connection string, the
 * one the congregation is pledging into, and this script writes administrator
 * accounts and audit rows. dotenv does not override a value already in the
 * environment, so an explicit DATABASE_URL wins, and refusing to run without
 * one is the difference between a Neon branch and the real thing.
 */
const explicitDatabaseUrl = process.env.DATABASE_URL;

config({ path: ".env.local" });

/**
 * The Google allowlist.
 *
 * Google will vouch for anybody who has a Google account, which is everybody,
 * so the only thing standing between a stranger and the pledge ledger is the
 * check that their address already belongs to an active administrator. This
 * exercises that check directly rather than through an OAuth round trip: the
 * decision is a plain function taking a db handle and an email, which is why
 * it can be tested at all.
 *
 * Four addresses are set up, one for each answer the gate has to give, and the
 * audit rows it writes are read back with SQL rather than trusted from a log.
 *
 * Writes accounts and audit rows, so point DATABASE_URL at a Neon branch.
 *
 * Usage:
 *   $env:DATABASE_URL="<branch connection string>"; pnpm db:verify:google
 */

const PASSWORD = "correct-horse-battery-staple";

const ACTIVE = "verify-part-ac-active@example.test";
const RETIRED = "verify-part-ac-retired@example.test";
const UNLINKED = "verify-part-ac-unlinked@example.test";
const STRANGER = "verify-part-ac-stranger@example.test";

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
        "This script writes administrator accounts and audit rows.",
        "",
        'Point it at a Neon branch:  $env:DATABASE_URL="<branch url>"; pnpm db:verify:google',
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const google = await import("@/server/services/admin-google");
  const audit = await import("@/server/services/admin-audit");
  const { getAuth } = await import("@/lib/auth");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(
      `${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`,
    );
  };

  // Say out loud which database this is about to write to, so a branch and the
  // live database are never confused from the transcript alone.
  const target = (
    await db.execute(sql`
      select current_database() as db,
             inet_server_addr()::text as host,
             (select count(*)::int from admin_users) as admins,
             (select count(*)::int from pledges) as pledges
    `)
  ).rows as Record<string, unknown>[];

  heading("the database this is writing to");
  show(target);

  await removeVerificationAdmins(db);
  await db.execute(sql`
    delete from audit_log
    where action = 'admin.google_rejected'
      and after->>'email' like 'verify-part-ac-%@example.test'
  `);

  try {
    heading("configuration is both keys or neither");

    check(
      "both keys set is configured",
      google.isGoogleConfigured({
        clientId: "an-id",
        clientSecret: "a-secret",
      }) === true,
    );
    check(
      "neither key set is not configured",
      google.isGoogleConfigured({
        clientId: undefined,
        clientSecret: undefined,
      }) === false,
    );
    check(
      "whitespace counts as absent",
      google.isGoogleConfigured({ clientId: "  ", clientSecret: "" }) === false,
    );

    for (const half of [
      { clientId: "an-id", clientSecret: undefined },
      { clientId: undefined, clientSecret: "a-secret" },
    ]) {
      let threw = false;
      try {
        google.isGoogleConfigured(half);
      } catch {
        threw = true;
      }
      check(
        `a half configured pair throws rather than guessing (${half.clientId ? "id only" : "secret only"})`,
        threw,
      );
    }

    /*
     * The provider is only registered when the keys are there. Read off the
     * built instance rather than inferred, because "the button renders but the
     * provider is missing" is exactly the state this is meant to rule out.
     */
    const configured = google.isGoogleConfigured({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    });
    const registered =
      getAuth().options.socialProviders?.google !== undefined;

    check(
      configured
        ? "keys are set, so the google provider is registered"
        : "no keys are set, so no google provider is registered",
      registered === configured,
      `configured=${configured} registered=${registered}`,
    );

    heading("four addresses, four answers");

    const active = await provisionAdmin(db, {
      email: ACTIVE,
      password: PASSWORD,
      fullName: "Active Admin",
      role: "treasurer",
    });
    const retired = await provisionAdmin(db, {
      email: RETIRED,
      password: PASSWORD,
      fullName: "Retired Admin",
      role: "treasurer",
    });
    await provisionAdmin(db, {
      email: UNLINKED,
      password: PASSWORD,
      fullName: "Unlinked Admin",
      role: "viewer",
    });

    await db.execute(sql`
      update admin_users set is_active = false where email = ${RETIRED}
    `);
    // The hole linkAuthUser exists to fill.
    await db.execute(sql`
      update admin_users set auth_user_id = null where email = ${UNLINKED}
    `);

    const activeGate = await google.checkGoogleSignIn(db, { email: ACTIVE });
    check(
      "an active administrator is allowed in",
      activeGate.allowed === true,
      activeGate.allowed ? `role=${activeGate.role}` : "refused",
    );
    check(
      "and is identified by their admin_users row, not a new one",
      activeGate.allowed && activeGate.adminUserId === active.adminUserId,
    );

    /*
     * Google sends the address as the account holder typed it. admin_users.email
     * is citext, so the match has to survive a different case without either
     * side normalising first.
     */
    const shouty = await google.checkGoogleSignIn(db, {
      email: ACTIVE.toUpperCase(),
    });
    check(
      "the same address in a different case is the same administrator",
      shouty.allowed === true && shouty.adminUserId === active.adminUserId,
    );

    const retiredGate = await google.checkGoogleSignIn(db, { email: RETIRED });
    check(
      "a retired administrator is refused",
      retiredGate.allowed === false && retiredGate.reason === "deactivated",
    );
    check(
      "and the refusal still knows which row they are",
      retiredGate.allowed === false &&
        retiredGate.adminUserId === retired.adminUserId,
    );

    const strangerGate = await google.checkGoogleSignIn(db, {
      email: STRANGER,
    });
    check(
      "an address that has never been an administrator is refused",
      strangerGate.allowed === false &&
        strangerGate.reason === "not_an_admin" &&
        strangerGate.adminUserId === null,
    );

    const emptyGate = await google.checkGoogleSignIn(db, { email: "" });
    check(
      "an empty address is refused rather than matched",
      emptyGate.allowed === false && emptyGate.reason === "not_an_admin",
    );

    heading("the same sentence, whatever the reason");

    check(
      "the message names no address and admits nothing",
      google.GOOGLE_REJECTED_MESSAGE ===
        "This Google account is not authorised for the admin portal. Contact the administrator.",
      google.GOOGLE_REJECTED_MESSAGE,
    );

    heading("every refusal leaves an audit row");

    for (const gate of [retiredGate, strangerGate]) {
      if (gate.allowed) continue;
      await audit.recordGoogleRejected(db, {
        email: gate.email,
        reason: gate.reason,
        adminUserId: gate.adminUserId,
        ip: "203.0.113.7",
        userAgent: "verification",
      });
    }

    const rows = (
      await db.execute(sql`
        select after->>'email'  as email,
               after->>'reason' as reason,
               actor_type,
               actor_id,
               entity,
               entity_id is not null as has_entity,
               ip::text           as ip
        from audit_log
        where action = 'admin.google_rejected'
          and after->>'email' like 'verify-part-ac-%@example.test'
        order by after->>'email'
      `)
    ).rows as Record<string, unknown>[];

    show(rows);

    check("one row per refusal, and no more", rows.length === 2, `${rows.length}`);
    check(
      "the attempted address is on the row",
      rows.some((r) => r.email === RETIRED) &&
        rows.some((r) => r.email === STRANGER),
    );
    check(
      "the reason separates a stranger from a retired administrator",
      rows.find((r) => r.email === STRANGER)?.reason === "not_an_admin" &&
        rows.find((r) => r.email === RETIRED)?.reason === "deactivated",
    );
    check(
      "nobody unproven is recorded as an admin actor",
      rows.every((r) => r.actor_type === "public" && r.actor_id === null),
    );
    check(
      "the retired row points at the administrator, the stranger's at nothing",
      rows.find((r) => r.email === RETIRED)?.has_entity === true &&
        rows.find((r) => r.email === STRANGER)?.has_entity === false,
    );

    heading("a refused address leaves nothing behind");

    const strays = (
      await db.execute(sql`
        select count(*)::int as n
        from auth_users
        where email = ${STRANGER}
      `)
    ).rows as { n: number }[];

    check(
      "no auth_users row exists for an address that was refused",
      strays[0]?.n === 0,
      `${strays[0]?.n} row(s)`,
    );

    heading("an authorised row with no link gets one");

    const [unlinkedRow] = (
      await db.execute(sql`
        select id::text as id from admin_users where email = ${UNLINKED}
      `)
    ).rows as { id: string }[];

    await google.linkAuthUser(db, {
      adminUserId: unlinkedRow.id,
      authUserId: active.authUserId,
    });

    const afterLink = (
      await db.execute(sql`
        select email, auth_user_id
        from admin_users
        where email in (${UNLINKED}, ${ACTIVE})
        order by email
      `)
    ).rows as Record<string, unknown>[];

    show(afterLink);

    check(
      "a null auth_user_id is filled",
      afterLink.find((r) => r.email === UNLINKED)?.auth_user_id ===
        active.authUserId,
    );

    // The guard that matters: linking must never move an account that already
    // has a credential onto somebody else's Better Auth user.
    await google.linkAuthUser(db, {
      adminUserId: active.adminUserId,
      authUserId: "some-other-auth-user",
    });

    const afterOverwrite = (
      await db.execute(sql`
        select auth_user_id from admin_users where email = ${ACTIVE}
      `)
    ).rows as { auth_user_id: string }[];

    check(
      "an existing link is never overwritten",
      afterOverwrite[0]?.auth_user_id === active.authUserId,
      String(afterOverwrite[0]?.auth_user_id),
    );

    heading(failures.length === 0 ? "all checks passed" : "failures");
    if (failures.length > 0) {
      failures.forEach((f) => console.log(`  ${f}`));
      process.exitCode = 1;
    }
  } finally {
    await removeVerificationAdmins(db);
    await db.execute(sql`
      delete from audit_log
      where action = 'admin.google_rejected'
        and after->>'email' like 'verify-part-ac-%@example.test'
    `);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
