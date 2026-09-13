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
  const {
    getAuth,
    requiresTotp,
    signInMethodOf,
    SIGN_IN_GOOGLE,
    SIGN_IN_PASSWORD,
  } = await import("@/lib/auth");
  const { summarise } = await import("@/server/services/audit");

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

  /*
   * audit_log is append only, enforced by a trigger, so this run cannot tidy
   * its rows away afterwards and must not try. The high water mark before it
   * starts is the baseline, and every assertion below counts only what this
   * run itself wrote. Absolutes would pass once and fail on every rerun.
   */
  const [{ baseline }] = (
    await db.execute(sql`
      select coalesce(max(id), 0)::bigint as baseline from audit_log
    `)
  ).rows as { baseline: string }[];

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
    const unlinked = await provisionAdmin(db, {
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

    heading("a sentence per reason, and a fallback for the rest");

    check(
      "a stranger is told the account is not authorised",
      google.messageForRejection("not_an_admin") ===
        "This Google account is not authorised for the admin portal. Contact the administrator.",
      google.messageForRejection("not_an_admin"),
    );
    check(
      "a retired administrator is told the account is deactivated",
      google.messageForRejection("deactivated") ===
        "This account has been deactivated. Contact the administrator.",
      google.messageForRejection("deactivated"),
    );
    check(
      "every reason the gate can give has a sentence of its own",
      (["not_an_admin", "deactivated"] as const).every(
        (reason) =>
          google.messageForRejection(reason) !== google.GOOGLE_FAILED_MESSAGE,
      ),
    );

    /*
     * The fallback is the security relevant half. Anything Better Auth or
     * Google puts on that query string, including text an attacker chose, has
     * to come out as our sentence rather than theirs.
     */
    for (const hostile of [
      undefined,
      "",
      "access_denied",
      "state_not_found",
      "Your account is fine, call 0700000000 to verify",
      "<script>alert(1)</script>",
    ]) {
      check(
        `an unrecognised code falls back to our own words (${JSON.stringify(hostile)?.slice(0, 32)})`,
        google.messageForRejection(hostile) === google.GOOGLE_FAILED_MESSAGE,
      );
    }

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
          and id > ${baseline}
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

    /*
     * Its own Better Auth user, the one provisioning made before the column
     * was nulled above. Not somebody else's: admin_users.auth_user_id is
     * unique, so pointing two administrators at one user is a constraint
     * violation rather than a test.
     */
    await google.linkAuthUser(db, {
      adminUserId: unlinkedRow.id,
      authUserId: unlinked.authUserId,
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
        unlinked.authUserId,
    );

    // The guard that matters: linking must never move an account that already
    // has a credential onto a different Better Auth user. A real id is used so
    // that the only thing standing in the way is the guard itself.
    await google.linkAuthUser(db, {
      adminUserId: active.adminUserId,
      authUserId: retired.authUserId,
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

    heading("the second factor policy");

    /*
     * The policy from CLAUDE.md's point of view: a password session has been
     * through TOTP, a Google session has been through Google instead. Asserted
     * against the function the portal actually calls, not restated here.
     */
    check(
      "a password session is asked for a TOTP code",
      requiresTotp(SIGN_IN_PASSWORD) === true,
    );
    check(
      "a google session is not",
      requiresTotp(SIGN_IN_GOOGLE) === false,
    );
    check(
      "a session with no method recorded is treated as a password one",
      requiresTotp(null) === true && requiresTotp(undefined) === true,
      "an old cookie cannot claim the google exemption",
    );

    /*
     * The bypass itself, at the level it actually happens.
     *
     * Better Auth's two factor plugin only intercepts the three credential
     * sign in paths. An OAuth callback is not among them, so a Google sign in
     * for an account with TOTP enrolled is handed a full session rather than a
     * two factor challenge. That is read off the plugin's own matcher rather
     * than asserted from a comment, so the day the library starts hooking
     * OAuth this check fails instead of the policy silently changing.
     */
    const totpPlugin = getAuth().options.plugins?.find(
      (plugin) => plugin.id === "two-factor",
    );

    /*
     * The matcher is typed for the full endpoint context but reads only path,
     * so a stub is enough and the cast goes through unknown deliberately.
     */
    const hooks = (totpPlugin?.hooks?.after ?? []) as unknown as {
      matcher: (context: { path: string }) => boolean;
    }[];
    const intercepts = (path: string) =>
      hooks.some((hook) => hook.matcher({ path }));

    check(
      "the two factor plugin is actually installed",
      hooks.length > 0,
      `${hooks.length} after hook(s)`,
    );
    check(
      "it does not intercept the google callback",
      intercepts("/callback/google") === false,
      "so an enrolled account gets a session, not a code prompt",
    );
    check(
      "and it still intercepts the password path",
      intercepts("/sign-in/email") === true,
      "so TOTP stays mandatory for email and password",
    );

    heading("an enrolled account signing in with google");

    /*
     * The same assertion end to end, against a real enrolled account. The
     * session is created the way the callback creates one, through Better
     * Auth's own adapter, and comes back complete rather than as a challenge.
     */
    await db.execute(sql`
      insert into auth_two_factors (id, user_id, secret, backup_codes, verified)
      values (
        ${`verify-ac-2fa-${active.authUserId}`},
        ${active.authUserId},
        'not-a-real-secret',
        '[]',
        true
      )
    `);
    await db.execute(sql`
      update auth_users set two_factor_enabled = true where id = ${active.authUserId}
    `);

    const enrolled = (
      await db.execute(sql`
        select u.two_factor_enabled as flag, count(t.id)::int as enrolments
        from auth_users u
        left join auth_two_factors t on t.user_id = u.id
        where u.id = ${active.authUserId}
        group by u.two_factor_enabled
      `)
    ).rows as Record<string, unknown>[];

    show(enrolled);

    check(
      "the account really is enrolled before the test means anything",
      String(enrolled[0]?.flag) === "true" &&
        Number(enrolled[0]?.enrolments) === 1,
    );

    /*
     * A session is created for the enrolled account the way Better Auth
     * creates one. Enrolment does not stand in the way of the row itself: the
     * challenge, when there is one, is imposed by the plugin's hook on the
     * credential paths, which the check above shows does not run here.
     */
    const ctx = await getAuth().$context;
    const session = await ctx.internalAdapter.createSession(
      active.authUserId,
      undefined,
    );

    check(
      "a session for an enrolled account comes back whole",
      Boolean(session?.token),
      "no two factor challenge in the way",
    );

    /*
     * Outside any endpoint, so the create hook takes its default branch and
     * writes "password". That is the branch worth asserting here, because it
     * is the one that decides what every ordinary sign in is recorded as, and
     * it proves the field is actually written rather than declared.
     *
     * The google branch needs a real OAuth callback to reach, so it is proven
     * end to end in the round trip rather than faked here. A createSession
     * call cannot stand in for it: the hook's return value is merged over any
     * override passed in, so forcing the value would assert nothing about the
     * code path that sets it.
     */
    check(
      "the method is written on the session row",
      signInMethodOf(session) === SIGN_IN_PASSWORD,
      String(signInMethodOf(session)),
    );

    const stored = (
      await db.execute(sql`
        select sign_in_method
        from auth_sessions
        where user_id = ${active.authUserId}
        order by created_at desc
        limit 1
      `)
    ).rows as Record<string, unknown>[];

    show(stored);

    check(
      "and it survives the round trip to the database",
      stored[0]?.sign_in_method === SIGN_IN_PASSWORD,
    );

    heading("the login row is written even with no address to record");

    /*
     * The session above was created outside any request, so Better Auth wrote
     * the empty string into ipAddress rather than null, and the audit hook
     * hung off that row had to insert it into an inet column. It used ??,
     * which does not catch an empty string, so the insert threw, the hook
     * swallowed the error, and admin.login was silently never written.
     *
     * CLAUDE.md allows no exceptions to that row, so this asserts the row
     * exists for the session that was just made rather than trusting that no
     * error appeared.
     */
    const hookRows = (
      await db.execute(sql`
        select after->>'method' as method, ip::text as ip
        from audit_log
        where action = 'admin.login'
          and actor_id = ${active.adminUserId}::uuid
          and id > ${baseline}
      `)
    ).rows as Record<string, unknown>[];

    show(hookRows);

    check(
      "the session hook wrote its admin.login row",
      hookRows.length === 1,
      `${hookRows.length} row(s)`,
    );
    check(
      "with a null address rather than a blank one",
      hookRows[0]?.ip === null,
      String(hookRows[0]?.ip),
    );

    heading("the audit row says how they got in");

    /*
     * A second high water mark. The session hook above wrote a real
     * admin.login row of its own, and counting from the original baseline
     * would sweep it into this check and make the expected count wrong.
     */
    const [{ loginBaseline }] = (
      await db.execute(sql`
        select coalesce(max(id), 0)::bigint as "loginBaseline" from audit_log
      `)
    ).rows as { loginBaseline: string }[];

    await audit.recordLoginSuccess(db, {
      adminUserId: active.adminUserId,
      email: ACTIVE,
      role: "treasurer",
      method: SIGN_IN_GOOGLE,
      ip: "203.0.113.7",
      userAgent: "verification",
    });
    await audit.recordLoginSuccess(db, {
      adminUserId: active.adminUserId,
      email: ACTIVE,
      role: "treasurer",
      method: SIGN_IN_PASSWORD,
      ip: "203.0.113.7",
      userAgent: "verification",
    });

    const logins = (
      await db.execute(sql`
        select after->>'method' as method,
               after->>'email'  as email
        from audit_log
        where action = 'admin.login'
          and id > ${loginBaseline}
        order by id
      `)
    ).rows as Record<string, unknown>[];

    show(logins);

    check(
      "the method is on the row",
      logins.length === 2 &&
        logins[0]?.method === SIGN_IN_GOOGLE &&
        logins[1]?.method === SIGN_IN_PASSWORD,
    );

    check(
      "and the detail formatter says it in words",
      summarise("admin.login", null, {
        email: ACTIVE,
        method: SIGN_IN_GOOGLE,
      }) === `email: ${ACTIVE}, signed in with Google` &&
        summarise("admin.login", null, {
          email: ACTIVE,
          method: SIGN_IN_PASSWORD,
        }) === `email: ${ACTIVE}, signed in with password`,
      summarise("admin.login", null, {
        email: ACTIVE,
        method: SIGN_IN_GOOGLE,
      }),
    );

    check(
      "a login with no method recorded still reads cleanly",
      summarise("admin.login", null, { email: ACTIVE }) === `email: ${ACTIVE}`,
    );

    check(
      "and a refusal reads as its reason",
      summarise("admin.google_rejected", null, {
        email: STRANGER,
        reason: "not_an_admin",
      }) === `email: ${STRANGER}, not an administrator`,
    );

    heading(failures.length === 0 ? "all checks passed" : "failures");
    if (failures.length > 0) {
      failures.forEach((f) => console.log(`  ${f}`));
      process.exitCode = 1;
    }
  } finally {
    // Only the accounts. The audit rows stay where they are, because
    // audit_log is append only and the baseline above is what keeps a rerun
    // honest.
    await removeVerificationAdmins(db);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
