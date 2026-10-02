import { config } from "dotenv";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Session 2D of the security hardening: the daily digest and the pruning,
 * both on the existing daily job.
 *
 * Digest: the figures, read against the database as deltas from a before
 * reading so whatever the branch already holds does not matter; who receives
 * it (active administrators and treasurers, never viewers); settings changes
 * included; empty skipped; the Saturday run skipped. Pruning: rows past 48
 * hours go from every rate limit table, rows inside it stay, expired payment
 * changes go after 30 days and not before, and nothing the treasurer needs is
 * touched.
 *
 * The last section calls the real job over HTTP, so the server must be
 * running against the branch with a dummy RESEND_API_KEY: the branch's
 * administrators are copies of the real ones and must not be emailed.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:digest-retention
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const IP = "198.51.100.200";
const PHONES = ["0799900931", "0799900932", "0799900933"];
const ADMIN_EMAILS = {
  treasurer: "digest.treasurer@example.test",
  viewer: "digest.viewer@example.test",
  retired: "digest.retired@example.test",
};
const RATE_KEY = "verify-part-av-rate-key";

function heading(text: string) {
  console.log(`\n== ${text} ==`);
}

async function main() {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const { CAMPAIGN_SLUG } = await import("@/lib/campaign");
  const pledges = await import("@/server/services/pledges");
  const digest = await import("@/server/services/digest");
  const retention = await import("@/server/services/retention");
  const { normalizeKenyanPhone } = await import("@/server/contracts/phone");
  const { AUDIT_TONES } = await import("@/components/admin/audit-table");
  const { summarise } = await import("@/server/services/audit");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  };
  const one = async <T>(q: ReturnType<typeof sql>) => (await db.execute(q)).rows[0] as T;

  const phones = PHONES.map((p) => normalizeKenyanPhone(p)!);
  const allPhones = sql.join(phones.map((p) => sql`${p}`), sql`, `);
  const allAdmins = sql.join(Object.values(ADMIN_EMAILS).map((e) => sql`${e}`), sql`, `);

  // The synthetic campaign.updated row in section 1 stays: audit_log is
  // append only and refuses a delete, which is the point of it. It is
  // labelled verify part-av in its after column.
  const cleanup = async () => {
    await db.execute(sql`delete from admin_users where email in (${allAdmins})`);
    await db.execute(sql`
      delete from pledges where pledger_id in (select id from pledgers where phone_e164 in (${allPhones}))
    `);
    await db.execute(sql`delete from pledgers where phone_e164 in (${allPhones})`);
    for (const table of ["pledge_lookups", "pledge_submissions", "public_list_requests"]) {
      await db.execute(sql`delete from ${sql.raw(table)} where ip = ${IP}::inet`);
    }
    await db.execute(sql`delete from admin_login_attempts where email in (${allAdmins})`);
    await db.execute(sql`delete from auth_rate_limits where key like ${`${RATE_KEY}%`}`);
    await db.execute(sql`delete from email_sends where recipient_hash like 'verify-part-av%'`);
    await db.execute(sql`
      delete from payment_detail_changes where current->>'verify' = 'part-av'
    `);
  };

  await cleanup();

  try {
    /* ------------------------------------------------------------------ */
    heading("1. the digest's figures, as deltas");
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const before = await digest.gather(db, { campaignSlug: CAMPAIGN_SLUG, since });

    const make = async (phone: string, amountKes: number) =>
      pledges.create(db, {
        input: {
          fullName: "Digest Fixture",
          phone,
          intent: "one_off" as const,
          amountKes,
          recordConsent: true as const,
          contactConsent: false,
          displayConsent: false,
        },
        campaignSlug: CAMPAIGN_SLUG,
      });

    // The largest possible, so it is the largest in the window whatever else is.
    const big = await make(phones[0]!, 1_000_000_000);
    await make(phones[1]!, 2_000);
    // An addition, trusted, so it applies.
    await make(phones[1]!, 3_000);
    // A held addition: not counted as received, counted as waiting.
    const held = await pledges.create(db, {
      input: {
        fullName: "Somebody Else",
        phone: phones[0]!,
        intent: "one_off" as const,
        amountKes: 500,
        recordConsent: true as const,
        contactConsent: false,
        displayConsent: false,
      },
      campaignSlug: CAMPAIGN_SLUG,
      ownership: { ownedPledgeIds: [] },
    });
    check("the fixture addition was held", "held" in held);

    // A settings change in the window, as the settings service records one.
    const [{ id: campaignId }] = (
      await db.execute(sql`select id::text as id from campaigns where slug = ${CAMPAIGN_SLUG}`)
    ).rows as { id: string }[];
    await db.execute(sql`
      insert into audit_log (actor_type, action, entity, entity_id, before, after)
      values ('admin', 'campaign.updated', 'campaign', ${campaignId}::uuid,
        '{"autoApproveLimitMinor": "500000000"}'::jsonb,
        '{"autoApproveLimitMinor": "100000000", "changed": ["autoApproveLimitMinor"], "verify": "part-av"}'::jsonb)
    `);

    const after = await digest.gather(db, { campaignSlug: CAMPAIGN_SLUG, since });
    const independent = await one<{ pledges: number; held: number }>(sql`
      select
        (select count(*)::int from pledges where status = 'pending' and deleted_at is null) as pledges,
        (select count(*)::int from pledge_increments where status = 'held') as held
    `);
    console.table([
      { when: "before", count: before.pledges.count, total: before.pledges.totalMinor.toString(), held: before.waiting.heldAdditions, settings: before.settings.length },
      { when: "after", count: after.pledges.count, total: after.pledges.totalMinor.toString(), held: after.waiting.heldAdditions, settings: after.settings.length },
    ]);
    check("three submissions received", after.pledges.count - before.pledges.count === 3);
    check("two of them new pledges", after.pledges.newPledges - before.pledges.newPledges === 2);
    check("one an addition", after.pledges.additions - before.pledges.additions === 1);
    check(
      "the total grew by exactly what was pledged",
      after.pledges.totalMinor - before.pledges.totalMinor === 100_000_000_000n + 200_000n + 300_000n,
    );
    check(
      "the largest is the fixture, by name and reference",
      after.pledges.largest?.reference === big.reference &&
        after.pledges.largest?.name === "Digest Fixture",
    );
    check("the held addition is waiting, not received", after.waiting.heldAdditions - before.waiting.heldAdditions === 1);
    check(
      "waiting counts agree with a straight count",
      after.waiting.heldAdditions === independent.held &&
        after.waiting.pendingPledges === independent.pledges,
      `${after.waiting.pendingPledges}/${independent.pledges} pending, ${after.waiting.heldAdditions}/${independent.held} held`,
    );
    const move = after.settings.find((s) => s.moves.some((m) => m.field === "autoApproveLimitMinor" && m.now === "100000000"));
    check("the settings change is in it", Boolean(move));
    check(
      "nothing about a phone or an address is in the data",
      !/\+2547|@/.test(JSON.stringify(after, (_k, v) => (typeof v === "bigint" ? v.toString() : v))),
    );

    /* ------------------------------------------------------------------ */
    heading("2. recipients: active administrators and treasurers only");
    await db.execute(sql`
      insert into admin_users (email, full_name, role, is_active) values
        (${ADMIN_EMAILS.treasurer}, 'Digest Treasurer', 'treasurer', true),
        (${ADMIN_EMAILS.viewer}, 'Digest Viewer', 'viewer', true),
        (${ADMIN_EMAILS.retired}, 'Digest Retired', 'treasurer', false)
    `);
    const to = await digest.recipients(db);
    const expected = (
      await db.execute(sql`
        select email::text as email from admin_users
        where is_active and role in ('admin', 'treasurer')
      `)
    ).rows.map((r) => (r as { email: string }).email);
    check("an active treasurer receives it", to.includes(ADMIN_EMAILS.treasurer));
    check("a viewer does not", !to.includes(ADMIN_EMAILS.viewer));
    check("an inactive treasurer does not", !to.includes(ADMIN_EMAILS.retired));
    check(
      "and the list is exactly the active admins and treasurers",
      to.length === expected.length && expected.every((e) => to.includes(e)),
      `${to.length} recipients`,
    );

    /* ------------------------------------------------------------------ */
    heading("3. empty is skipped, and the Saturday run is skipped");
    const future = await digest.gather(db, {
      campaignSlug: CAMPAIGN_SLUG,
      since: new Date(Date.now() + 60 * 60 * 1000),
    });
    check("a window with nothing in it receives nothing", future.pledges.count === 0 && future.settings.length === 0);
    check(
      "and is empty exactly when nothing waits either",
      digest.isEmpty(future) ===
        (future.waiting.heldAdditions + future.waiting.changeRequests + future.waiting.pendingPledges + future.waiting.pendingPaymentChanges === 0),
    );
    check(
      "the run at 00:05 Saturday in Nairobi is skipped",
      digest.digestSchedule(new Date("2026-10-02T21:05:00Z")).send === false,
    );
    check(
      "and Sunday's looks back 48 hours",
      JSON.stringify(digest.digestSchedule(new Date("2026-10-03T21:05:00Z"))) ===
        JSON.stringify({ send: true, windowHours: 48 }),
    );

    /* ------------------------------------------------------------------ */
    heading("4. pruning");
    const [{ id: adminId }] = (
      await db.execute(sql`select id::text as id from admin_users order by created_at limit 1`)
    ).rows as { id: string }[];

    // Either side of each line.
    for (const table of ["pledge_lookups", "pledge_submissions", "public_list_requests"]) {
      const extra = table === "pledge_lookups" ? sql`, found` : sql``;
      const extraValue = table === "pledge_lookups" ? sql`, false` : sql``;
      await db.execute(sql`
        insert into ${sql.raw(table)} (ip, at ${extra}) values
          (${IP}::inet, now() - interval '49 hours' ${extraValue}),
          (${IP}::inet, now() - interval '47 hours' ${extraValue})
      `);
    }
    await db.execute(sql`
      insert into admin_login_attempts (email, at) values
        (${ADMIN_EMAILS.viewer}, now() - interval '49 hours'),
        (${ADMIN_EMAILS.viewer}, now() - interval '47 hours')
    `);
    await db.execute(sql`
      insert into auth_rate_limits (id, key, count, last_request) values
        (${`${RATE_KEY}-old`}, ${`${RATE_KEY}-old`}, 1, (extract(epoch from now() - interval '49 hours') * 1000)::bigint),
        (${`${RATE_KEY}-new`}, ${`${RATE_KEY}-new`}, 1, (extract(epoch from now() - interval '47 hours') * 1000)::bigint)
    `);
    await db.execute(sql`
      insert into email_sends (recipient_hash, kind, at) values
        ('verify-part-av-old', 'pledge_confirmation', now() - interval '49 hours'),
        ('verify-part-av-new', 'pledge_confirmation', now() - interval '47 hours')
    `);
    const fields = sql`'{"verify": "part-av"}'::jsonb`;
    await db.execute(sql`
      insert into payment_detail_changes
        (campaign_id, current, proposed, status, requested_by, requested_at, expires_at, decided_by, decided_at)
      values
        (${campaignId}::uuid, ${fields}, ${fields}, 'expired', ${adminId}::uuid, now() - interval '38 days', now() - interval '31 days', null, now() - interval '31 days'),
        (${campaignId}::uuid, ${fields}, ${fields}, 'expired', ${adminId}::uuid, now() - interval '36 days', now() - interval '29 days', null, now() - interval '29 days'),
        (${campaignId}::uuid, ${fields}, ${fields}, 'rejected', ${adminId}::uuid, now() - interval '90 days', now() - interval '83 days', ${adminId}::uuid, now() - interval '89 days')
    `);

    const kept = sql`
      select
        (select count(*)::int from audit_log where action <> 'system.retention_pruned') as audit,
        (select count(*)::int from pledge_increments) as increments,
        (select count(*)::int from pledge_increments where status = 'held') as held,
        (select count(*)::int from pledge_change_requests) as requests,
        (select count(*)::int from payments) as payments,
        (select count(*)::int from pledges) as pledges,
        (select count(*)::int from payment_detail_changes where status in ('approved','rejected','pending')) as decided_changes
    `;
    const stale = sql`
      select
        (select count(*)::int from pledge_lookups where at < now() - interval '48 hours') as lookups,
        (select count(*)::int from pledge_submissions where at < now() - interval '48 hours') as submissions,
        (select count(*)::int from public_list_requests where at < now() - interval '48 hours') as list,
        (select count(*)::int from admin_login_attempts where at < now() - interval '48 hours') as logins,
        (select count(*)::int from auth_rate_limits where last_request < (extract(epoch from now() - interval '48 hours') * 1000)::bigint) as auth,
        (select count(*)::int from email_sends where at < now() - interval '48 hours') as sends,
        (select count(*)::int from payment_detail_changes where status = 'expired' and expires_at < now() - interval '30 days') as expired
    `;
    const keptBefore = await one<Record<string, number>>(kept);
    const staleBefore = await one<Record<string, number>>(stale);
    console.table([{ when: "stale before", ...staleBefore }]);

    const result = await retention.prune(db);
    console.table([result]);

    const staleAfter = await one<Record<string, number>>(stale);
    const keptAfter = await one<Record<string, number>>(kept);
    console.table([{ when: "stale after", ...staleAfter }]);
    check("nothing past its time is left in any table", Object.values(staleAfter).every((n) => n === 0), JSON.stringify(staleAfter));
    check(
      "the counts reported are the rows that were there",
      result.pledgeLookups === staleBefore.lookups &&
        result.pledgeSubmissions === staleBefore.submissions &&
        result.publicListRequests === staleBefore.list &&
        result.adminLoginAttempts === staleBefore.logins &&
        result.authRateLimits === staleBefore.auth &&
        result.emailSends === staleBefore.sends &&
        result.expiredPaymentChanges === staleBefore.expired,
    );

    const fresh = await one<Record<string, number>>(sql`
      select
        (select count(*)::int from pledge_lookups where ip = ${IP}::inet) as lookups,
        (select count(*)::int from pledge_submissions where ip = ${IP}::inet) as submissions,
        (select count(*)::int from public_list_requests where ip = ${IP}::inet) as list,
        (select count(*)::int from admin_login_attempts where email = ${ADMIN_EMAILS.viewer}) as logins,
        (select count(*)::int from auth_rate_limits where key like ${`${RATE_KEY}%`}) as auth,
        (select count(*)::int from email_sends where recipient_hash like 'verify-part-av%') as sends,
        (select count(*)::int from payment_detail_changes where current->>'verify' = 'part-av' and status = 'expired') as expired,
        (select count(*)::int from payment_detail_changes where current->>'verify' = 'part-av' and status = 'rejected') as rejected
    `);
    console.table([fresh]);
    check(
      "each table keeps its row inside 48 hours",
      [fresh.lookups, fresh.submissions, fresh.list, fresh.logins, fresh.auth, fresh.sends].every((n) => n === 1),
    );
    check("an expired change 29 days old stays", fresh.expired === 1);
    check("a rejected change, however old, stays", fresh.rejected === 1);
    check(
      "the audit log, increments, held additions, requests, payments, pledges and decided changes are untouched",
      JSON.stringify(keptAfter) === JSON.stringify(keptBefore),
      JSON.stringify(keptAfter),
    );

    const journal = await one<{ after: Record<string, unknown> } | undefined>(sql`
      select after from audit_log where action = 'system.retention_pruned' order by at desc limit 1
    `);
    check("one system row records what went", journal?.after?.pledgeLookups === result.pledgeLookups);
    check("with a tone", "system.retention_pruned" in AUDIT_TONES);
    const line = summarise("system.retention_pruned", null, journal?.after ?? null);
    check("and a detail line", line.startsWith("removed "), line);

    const again = await retention.prune(db);
    check("a second run finds nothing and writes no row", retention.prunedTotal(again) === 0);

    /* ------------------------------------------------------------------ */
    heading("5. the real job, over HTTP");
    const response = await fetch(`${BASE}/api/cron/daily-snapshot`, {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
    });
    const body = (await response.json()) as {
      pruned?: Record<string, number> | null;
      digest?: { status: string; reason?: string; recipients?: number; failed?: number; windowHours?: number };
    };
    console.table([{ status: response.status, pruned: JSON.stringify(body.pruned), digest: JSON.stringify(body.digest) }]);
    check("the job answers", response.status === 200);
    check("and pruned as part of it", body.pruned !== undefined && body.pruned !== null);
    const expectedSchedule = digest.digestSchedule(new Date());
    if (expectedSchedule.send) {
      check(
        "the digest went to every recipient, and the dummy key refused each send",
        body.digest?.status === "sent" &&
          body.digest.recipients === expected.length &&
          body.digest.failed === expected.length,
        JSON.stringify(body.digest),
      );
    } else {
      check(
        "today is the Sabbath run, so the digest was skipped",
        body.digest?.status === "skipped" && body.digest.reason === "sabbath",
        JSON.stringify(body.digest),
      );
    }
  } finally {
    await cleanup();
  }

  console.log(
    failures.length === 0
      ? "\nall checks passed"
      : `\n${failures.length} FAILED:\n  ${failures.join("\n  ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
