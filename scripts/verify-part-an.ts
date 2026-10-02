import { config } from "dotenv";

import { provisionAdmin, removeVerificationAdmins } from "./verification-admin";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Session 1A of the security hardening: per address backstops, and payment
 * detail changes that need two people.
 *
 * Runs against the services directly, so no server and no email. What the
 * routes add on top, the permission gate and the refusal when email is not
 * configured, is covered by db:verify:settings against a running server.
 *
 * Everything it changes is put back at the end.
 *
 * Usage: pnpm db:verify:payment-changes
 */

const CAMPAIGN_SLUG = "crystal-fountain";
const PASSWORD = "correct-horse-battery-staple";
const LIMIT_IP = "198.51.100.77";
const PHONE = "0799900301";

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
  const campaign = await import("@/server/services/campaign");
  const changes = await import("@/server/services/payment-changes");
  const pledges = await import("@/server/services/pledges");
  const requests = await import("@/server/services/change-requests");
  const publicList = await import("@/server/services/public-pledgers");
  const { isServiceError } = await import("@/server/errors");
  const { normalizeKenyanPhone } = await import("@/server/contracts/phone");
  const { renderPaymentChangeNotice } = await import("@/server/email/payment-change");
  const { AUDIT_TONES } = await import("@/components/admin/audit-table");
  const { summarise } = await import("@/server/services/audit");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  };

  const codeOf = async (work: () => Promise<unknown>): Promise<string> => {
    try {
      await work();
      return "accepted";
    } catch (error) {
      return isServiceError(error) ? `${error.status} ${error.code}` : String(error);
    }
  };

  const phone = normalizeKenyanPhone(PHONE)!;
  const original = await campaign.getSettings(db, { campaignSlug: CAMPAIGN_SLUG });

  const realSuper = await db.execute(sql`select email from admin_users where is_super`);
  const realSuperEmail =
    (realSuper.rows[0] as { email: string } | undefined)?.email ?? null;

  const cleanup = async () => {
    await db.execute(sql`
      delete from pledges
      where pledger_id in (select id from pledgers where phone_e164 = ${phone})
    `);
    await db.execute(sql`delete from pledgers where phone_e164 = ${phone}`);
    await db.execute(sql`delete from pledge_submissions where ip = ${LIMIT_IP}::inet`);
    await db.execute(sql`
      update campaigns
      set target_minor = ${original.targetMinor.toString()}::bigint,
          mpesa_paybill = ${original.mpesaPaybill},
          mpesa_account_name = ${original.mpesaAccountName},
          bank_name = ${original.bankName},
          bank_branch = ${original.bankBranch},
          bank_account_name = ${original.bankAccountName},
          bank_account = ${original.bankAccount},
          bank_swift = ${original.bankSwift},
          bank_branch_code = ${original.bankBranchCode}
      where slug = ${CAMPAIGN_SLUG}
    `);
    await removeVerificationAdmins(db);
    if (realSuperEmail) {
      await db.execute(sql`update admin_users set is_super = false where is_super`);
      await db.execute(sql`update admin_users set is_super = true where email = ${realSuperEmail}`);
    }
  };

  await cleanup();

  try {
    // 1. The migration.
    heading("1. the tables landed");
    const tables = await db.execute(sql`
      select table_name from information_schema.tables
      where table_name in ('payment_detail_changes', 'pledge_submissions')
      order by table_name
    `);
    show(tables.rows as Record<string, unknown>[]);
    check("both tables exist", tables.rows.length === 2);

    const constraints = await db.execute(sql`
      select conname from pg_constraint
      where conrelid = 'payment_detail_changes'::regclass and contype = 'c'
      order by conname
    `);
    show(constraints.rows as Record<string, unknown>[]);
    check(
      "with the self approval check in the database",
      (constraints.rows as { conname: string }[]).some(
        (r) => r.conname === "payment_detail_changes_not_self_approved_check",
      ),
    );

    // 2. The backstops.
    heading("2. per address limits sit at backstop level");
    const limits = [
      { limit: "pledge creation", per_hour: pledges.PLEDGE_IP_LIMIT, window: pledges.PLEDGE_IP_WINDOW_SECONDS },
      { limit: "redeem lookup and consent withdrawal", per_hour: pledges.LOOKUP_RATE_LIMIT, window: pledges.LOOKUP_RATE_WINDOW_SECONDS },
      { limit: "change requests", per_hour: requests.CHANGE_REQUEST_IP_LIMIT, window: requests.CHANGE_REQUEST_IP_WINDOW_SECONDS },
      { limit: "public pledgers list", per_hour: publicList.PUBLIC_LIST_RATE_LIMIT, window: publicList.PUBLIC_LIST_RATE_WINDOW_SECONDS },
    ];
    show(limits);
    check(
      "every one is at least three hundred an hour, counted over an hour",
      limits.every((l) => l.per_hour >= 300 && l.window === 3_600),
    );

    const base = {
      fullName: "Backstop Tester",
      phone,
      intent: "one_off" as const,
      amountKes: 1_000,
      recordConsent: true as const,
      contactConsent: false,
      displayConsent: false,
    };

    await db.execute(sql`
      insert into pledge_submissions (ip)
      select ${LIMIT_IP}::inet from generate_series(1, ${pledges.PLEDGE_IP_LIMIT - 1})
    `);
    const last = await codeOf(() =>
      pledges.create(db, {
        input: base,
        campaignSlug: CAMPAIGN_SLUG,
        request: { ip: LIMIT_IP },
      }),
    );
    check("the three hundredth pledge from one address is recorded", last === "accepted", last);

    const over = await codeOf(() =>
      pledges.create(db, {
        input: base,
        campaignSlug: CAMPAIGN_SLUG,
        request: { ip: LIMIT_IP },
      }),
    );
    check("the next is refused with 429", over === "429 pledge_ip_limited", over);

    const recorded = await db.execute(sql`
      select count(*)::int as n from pledge_submissions where ip = ${LIMIT_IP}::inet
    `);
    check(
      "and the refused attempt was counted too",
      (recorded.rows[0] as { n: number }).n === pledges.PLEDGE_IP_LIMIT + 1,
      `${(recorded.rows[0] as { n: number }).n} rows`,
    );

    const atDesk = await codeOf(() =>
      pledges.create(db, {
        input: base,
        campaignSlug: CAMPAIGN_SLUG,
        channel: "admin",
        request: { ip: LIMIT_IP },
      }),
    );
    check("a treasurer entering a pledge is not held to it", atDesk === "accepted", atDesk);

    // 3. Two people for a payment change.
    heading("3. payment details need a second administrator");
    const make = async (slug: string, role: string) =>
      (
        await provisionAdmin(db, {
          email: `verify-part-an-${slug}@example.test`,
          password: PASSWORD,
          fullName: `Payment ${slug}`,
          role,
        })
      ).adminUserId;

    const superId = await make("super", "admin");
    await db.execute(sql`update admin_users set is_super = false where is_super`);
    await db.execute(sql`update admin_users set is_super = true where id = ${superId}::uuid`);
    const secondId = await make("second", "admin");
    const treasurerId = await make("treasurer", "treasurer");
    const viewerId = await make("viewer", "viewer");
    const retiredId = await make("retired", "admin");
    await db.execute(sql`update admin_users set is_active = false where id = ${retiredId}::uuid`);

    const before = await campaign.getSettings(db, { campaignSlug: CAMPAIGN_SLUG });

    const asked = await campaign.updateSettings(db, {
      campaignSlug: CAMPAIGN_SLUG,
      input: { targetKes: 777_000_000, mpesaPaybill: "424242", bankAccount: "<b>0001</b>" },
      adminId: superId,
    });
    const id = asked.paymentChange?.changeId ?? "";
    const mid = await campaign.getSettings(db, { campaignSlug: CAMPAIGN_SLUG });
    show([
      {
        changed: asked.changed.join(","),
        pending: id !== "",
        target: mid.targetMinor,
        paybill_live: mid.mpesaPaybill,
      },
    ]);
    check("the target applied directly", mid.targetMinor === 77_700_000_000n);
    check("the payment fields became a pending change", id !== "");
    check(
      "and the live payment details did not move",
      mid.mpesaPaybill === before.mpesaPaybill && mid.bankAccount === before.bankAccount,
    );
    check(
      "the change expires in seven days",
      Math.abs(
        (asked.paymentChange?.expiresAt.getTime() ?? 0) -
          (asked.paymentChange?.requestedAt.getTime() ?? 0) -
          7 * 86_400_000,
      ) < 5_000,
    );

    const second = await codeOf(() =>
      campaign.updateSettings(db, {
        campaignSlug: CAMPAIGN_SLUG,
        input: { mpesaPaybill: "434343" },
        adminId: superId,
      }),
    );
    check("a second request while one waits is refused", second === "409 payment_change_pending", second);

    const self = await codeOf(() =>
      changes.decide(db, { changeId: id, decision: "approve", adminId: superId }),
    );
    check("the requester cannot approve", self === "403 payment_change_self_approval", self);

    let dbRefused = false;
    try {
      await db.execute(sql`
        update payment_detail_changes
        set status = 'approved', decided_by = requested_by, decided_at = now()
        where id = ${id}::uuid
      `);
    } catch {
      dbRefused = true;
    }
    check("and neither will the database, whatever code asks", dbRefused);

    const byViewer = await codeOf(() =>
      changes.decide(db, { changeId: id, decision: "approve", adminId: viewerId }),
    );
    check("a viewer cannot approve", byViewer === "403 payment_change_needs_treasurer", byViewer);

    const byRetired = await codeOf(() =>
      changes.decide(db, { changeId: id, decision: "approve", adminId: retiredId }),
    );
    check("an inactive administrator cannot approve", byRetired === "403 admin_inactive", byRetired);

    const approved = await changes.decide(db, { changeId: id, decision: "approve", adminId: secondId });
    const live = await campaign.getSettings(db, { campaignSlug: CAMPAIGN_SLUG });
    check(
      "a different active administrator can, and the details go live",
      approved.event === "approved" && live.mpesaPaybill === "424242" && live.bankAccount === "<b>0001</b>",
      `${live.mpesaPaybill} ${live.bankAccount}`,
    );

    const twice = await codeOf(() =>
      changes.decide(db, { changeId: id, decision: "reject", adminId: secondId }),
    );
    check("a decided change cannot be decided again", twice === "409 payment_change_not_pending", twice);

    // A treasurer may give the second signature too.
    const byTreasurerChange = await campaign.updateSettings(db, {
      campaignSlug: CAMPAIGN_SLUG,
      input: { mpesaAccountName: "Treasurer Approved Fund" },
      adminId: superId,
    });
    const byTreasurer = await changes.decide(db, {
      changeId: byTreasurerChange.paymentChange!.changeId,
      decision: "approve",
      adminId: treasurerId,
    });
    const afterTreasurer = await campaign.getSettings(db, { campaignSlug: CAMPAIGN_SLUG });
    check(
      "a treasurer who did not ask can approve",
      byTreasurer.event === "approved" && afterTreasurer.mpesaAccountName === "Treasurer Approved Fund",
    );

    // Withdrawn by the person who asked.
    const withdrawn = await campaign.updateSettings(db, {
      campaignSlug: CAMPAIGN_SLUG,
      input: { bankName: "Somewhere Else Bank" },
      adminId: superId,
    });
    await changes.decide(db, {
      changeId: withdrawn.paymentChange!.changeId,
      decision: "reject",
      adminId: superId,
    });
    const afterReject = await campaign.getSettings(db, { campaignSlug: CAMPAIGN_SLUG });
    check("the requester can withdraw by rejecting", afterReject.bankName === live.bankName);

    // Stale: the live details moved underneath the request.
    const stale = await campaign.updateSettings(db, {
      campaignSlug: CAMPAIGN_SLUG,
      input: { bankSwift: "STALEXXX" },
      adminId: superId,
    });
    await db.execute(sql`update campaigns set bank_branch = 'Moved meanwhile' where slug = ${CAMPAIGN_SLUG}`);
    const staleCode = await codeOf(() =>
      changes.decide(db, { changeId: stale.paymentChange!.changeId, decision: "approve", adminId: secondId }),
    );
    check("a change asked against details that have since moved is refused", staleCode === "409 payment_change_stale", staleCode);
    await changes.decide(db, { changeId: stale.paymentChange!.changeId, decision: "reject", adminId: secondId });

    // Expiry.
    const old = await campaign.updateSettings(db, {
      campaignSlug: CAMPAIGN_SLUG,
      input: { bankBranchCode: "999" },
      adminId: superId,
    });
    const oldId = old.paymentChange!.changeId;
    await db.execute(sql`
      update payment_detail_changes
      set requested_at = now() - interval '8 days', expires_at = now() - interval '1 day'
      where id = ${oldId}::uuid
    `);
    const late = await codeOf(() =>
      changes.decide(db, { changeId: oldId, decision: "approve", adminId: secondId }),
    );
    check("a change past seven days cannot be approved", late === "409 payment_change_not_pending", late);
    const expired = await changes.expireStale(db);
    const expiredRow = await db.execute(sql`
      select status from payment_detail_changes where id = ${oldId}::uuid
    `);
    check(
      "the sweep marks it expired",
      expired.some((n) => n.changeId === oldId) &&
        (expiredRow.rows[0] as { status: string }).status === "expired",
    );

    // 4. The journal.
    heading("4. every step is in the journal");
    const journal = await db.execute(sql`
      select action, actor_type, after ->> 'changeId' as change_id,
             before ->> 'mpesaPaybill' as was, after ->> 'mpesaPaybill' as now
      from audit_log
      where action like 'campaign.payment_change_%'
        and after ->> 'changeId' in (${id}, ${oldId})
      order by id
    `);
    show(journal.rows as Record<string, unknown>[]);
    const actions = (journal.rows as { action: string; actor_type: string }[]).map(
      (r) => `${r.action}/${r.actor_type}`,
    );
    check(
      "request, approval and expiry rows exist",
      actions.join(",") ===
        [
          "campaign.payment_change_requested/admin",
          "campaign.payment_change_approved/admin",
          "campaign.payment_change_requested/admin",
          "campaign.payment_change_expired/system",
        ].join(","),
      actions.join(","),
    );
    const rejectedRows = await db.execute(sql`
      select count(*)::int as n from audit_log
      where action = 'campaign.payment_change_rejected'
        and after ->> 'changeId' in (${withdrawn.paymentChange!.changeId}, ${stale.paymentChange!.changeId})
    `);
    check("and a rejection row for each rejection", (rejectedRows.rows[0] as { n: number }).n === 2);

    const toned = [
      "campaign.payment_change_requested",
      "campaign.payment_change_approved",
      "campaign.payment_change_rejected",
      "campaign.payment_change_expired",
    ];
    check("all four actions have a tone", toned.every((a) => a in AUDIT_TONES));
    const line = summarise(
      "campaign.payment_change_approved",
      { mpesaPaybill: "111111" },
      { mpesaPaybill: "424242", changed: ["mpesaPaybill"] },
    );
    check("the detail line shows the old and new value", line === "approved: paybill 111111 → 424242", line);

    // 5. The email.
    heading("5. the notice every administrator receives");
    const { builtInPaymentDetails } = await import("@/lib/payment-details");
    const builtIn = builtInPaymentDetails();
    const message = renderPaymentChangeNotice(asked.paymentChange!, {
      siteUrl: "https://pledge.example.test",
      builtIn,
    });
    const liveBefore = before.mpesaPaybill || `${builtIn.mpesaPaybill} (built into the site)`;
    check(
      "shows the old and new paybill in full, as members would see them",
      message.text.includes(`Current: ${liveBefore}`) &&
        message.text.includes("Proposed: 424242"),
      liveBefore,
    );
    check("and never calls a field that falls back to the site's value not set", !message.text.includes("not set"));
    check(
      "escapes what it prints",
      message.html.includes("&lt;b&gt;0001&lt;/b&gt;") && !message.html.includes("<b>0001</b>"),
    );
    check("and has no em dash", !message.html.includes("—") && !message.text.includes("—"));
    console.log(`subject: ${message.subject}`);

    const { renderSettingsChangedNotice } = await import("@/server/email/settings-change");
    const settingsMessage = renderSettingsChangedNotice({
      moved: asked.moved,
      changedByName: "Payment <super>",
      siteUrl: "https://pledge.example.test",
    });
    check(
      "the settings notice names what moved, before and after",
      settingsMessage.text.includes("Target:") && settingsMessage.text.includes("KES 777,000,000"),
      settingsMessage.text.split("\n").find((l) => l.startsWith("- ")) ?? "",
    );
    check(
      "and escapes the name it prints",
      settingsMessage.html.includes("Payment &lt;super&gt;"),
    );
  } finally {
    heading("6. cleanup");
    await cleanup();
  }

  const restored = await campaign.getSettings(db, { campaignSlug: CAMPAIGN_SLUG });
  check(
    "the campaign is back where it started",
    restored.targetMinor === original.targetMinor &&
      restored.mpesaPaybill === original.mpesaPaybill &&
      restored.bankAccount === original.bankAccount &&
      restored.bankBranch === original.bankBranch,
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
