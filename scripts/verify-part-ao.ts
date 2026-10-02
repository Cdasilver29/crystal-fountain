import { config } from "dotenv";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Session 1C of the security hardening: held additions.
 *
 * An addition to a pledge applies only when the browser proves it made the
 * pledge. Every other addition is recorded as held and moves nothing: not the
 * pledge, not the pledger, not the public total. The deferred invariant
 * triggers sum applied increments only, and this proves they pass with a held
 * increment present.
 *
 * Against the services directly, so no server. The route and the cookie are
 * covered by db:verify:ownership.
 *
 * Usage: pnpm db:verify:held-additions
 */

const CAMPAIGN_SLUG = "crystal-fountain";
const PHONE = "0799900401";
const NEWCOMER = "0799900402";
const NOTICED = "0799900403";
const RECORD_EMAIL = "noticed.pledger@example.test";

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
  const pledges = await import("@/server/services/pledges");
  const campaign = await import("@/server/services/campaign");
  const { normalizeKenyanPhone } = await import("@/server/contracts/phone");
  const { AUDIT_TONES } = await import("@/components/admin/audit-table");
  const { summarise } = await import("@/server/services/audit");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  };

  const phone = normalizeKenyanPhone(PHONE)!;
  const newcomer = normalizeKenyanPhone(NEWCOMER)!;
  const noticed = normalizeKenyanPhone(NOTICED)!;

  const cleanup = async () => {
    for (const p of [phone, newcomer, noticed]) {
      await db.execute(sql`
        delete from pledges
        where pledger_id in (select id from pledgers where phone_e164 = ${p})
      `);
      await db.execute(sql`delete from pledgers where phone_e164 = ${p}`);
    }
  };

  await cleanup();

  const base = {
    intent: "one_off" as const,
    recordConsent: true as const,
    contactConsent: false,
    displayConsent: false,
  };

  try {
    // 1. The migration.
    heading("1. the column, its default and the triggers");
    const column = await db.execute(sql`
      select column_default, is_nullable from information_schema.columns
      where table_name = 'pledge_increments' and column_name = 'status'
    `);
    show(column.rows as Record<string, unknown>[]);
    const col = column.rows[0] as { column_default: string; is_nullable: string } | undefined;
    check(
      "status exists, is not null, and defaults to applied",
      col?.is_nullable === "NO" && (col?.column_default ?? "").includes("'applied'"),
      col?.column_default,
    );

    const fn = await db.execute(sql`
      select pg_get_functiondef('assert_pledge_matches_increments'::regproc) as def
    `);
    check(
      "the invariant function sums applied increments only",
      ((fn.rows[0] as { def: string }).def ?? "").includes("status = 'applied'"),
    );

    const triggers = await db.execute(sql`
      select tgname, tgdeferrable, tginitdeferred from pg_trigger
      where tgname in ('pledges_match_increments', 'pledge_increments_match_pledge')
      order by tgname
    `);
    show(triggers.rows as Record<string, unknown>[]);
    check(
      "both triggers are still there, deferrable and initially deferred",
      triggers.rows.length === 2 &&
        (triggers.rows as { tgdeferrable: boolean; tginitdeferred: boolean }[]).every(
          (t) => t.tgdeferrable && t.tginitdeferred,
        ),
    );

    // 2. Nothing that already exists changed.
    heading("2. every existing increment is applied and every pledge balances");
    const ledger = await db.execute(sql`
      select count(*)::int as increments,
             count(*) filter (where status = 'applied')::int as applied,
             (select count(*)::int from pledges p
               where p.amount_minor <> coalesce((select sum(i.amount_minor)
                 from pledge_increments i
                 where i.pledge_id = p.id and i.status = 'applied'), 0)) as unbalanced
      from pledge_increments
    `);
    show(ledger.rows as Record<string, unknown>[]);
    const l = ledger.rows[0] as { increments: number; applied: number; unbalanced: number };
    check("every increment on the branch is applied", l.increments === l.applied);
    check("no pledge disagrees with its applied increments", l.unbalanced === 0);

    // 3. A held addition.
    heading("3. an addition from a browser that did not make the pledge");
    const first = await pledges.create(db, {
      input: { ...base, fullName: "Ruth Achieng Odhiambo", phone, email: "ruth@example.test", amountKes: 200_000 },
      campaignSlug: CAMPAIGN_SLUG,
    });
    await pledges.approve(db, { pledgeId: first.pledgeId });

    const totalsBefore = await campaign.getTotals(db, { campaignSlug: CAMPAIGN_SLUG });

    const held = await pledges.create(db, {
      input: { ...base, fullName: "Somebody Else", phone, email: "stranger@example.test", amountKes: 9_000_000 },
      campaignSlug: CAMPAIGN_SLUG,
      ownership: { ownedPledgeIds: [] },
    });

    show([{ ...held }]);
    check("comes back held", "held" in held && held.held === true);
    check(
      "and reveals nothing about the pledge: no reference, token, total or status",
      !("reference" in held) && !("publicToken" in held) && !("amountMinor" in held) && !("status" in held),
      Object.keys(held).join(","),
    );

    const after = await db.execute(sql`
      select p.amount_minor::text as amount, p.status::text as status,
             pr.full_name, pr.email,
             (select count(*)::int from pledge_increments i where i.pledge_id = p.id and i.status = 'held') as held
      from pledges p join pledgers pr on pr.id = p.pledger_id
      where p.id = ${first.pledgeId}::uuid
    `);
    show(after.rows as Record<string, unknown>[]);
    const a = after.rows[0] as { amount: string; status: string; full_name: string; email: string; held: number };
    check("the commit passed the invariant triggers with a held increment present", a.held === 1);
    check("the pledge amount did not move", a.amount === "20000000", a.amount);
    check("nor its status", a.status === "verified", a.status);
    check(
      "and the pledger's name and email were not overwritten",
      a.full_name === "Ruth Achieng Odhiambo" && a.email === "ruth@example.test",
      `${a.full_name} ${a.email}`,
    );

    const totalsAfter = await campaign.getTotals(db, { campaignSlug: CAMPAIGN_SLUG });
    check(
      "the public total did not move",
      totalsAfter.pledgedMinor === totalsBefore.pledgedMinor,
      `${totalsBefore.pledgedMinor} -> ${totalsAfter.pledgedMinor}`,
    );

    // 4. The database will not let a held row count without the amount.
    heading("4. what the database refuses");
    const heldRow = await db.execute(sql`
      select id from pledge_increments where pledge_id = ${first.pledgeId}::uuid and status = 'held'
    `);
    const heldId = (heldRow.rows[0] as { id: string }).id;

    let flipped = false;
    try {
      await db.execute(sql`update pledge_increments set status = 'applied' where id = ${heldId}`);
    } catch {
      flipped = true;
    }
    check("flipping a held row to applied without moving the amount is refused", flipped);

    const refusedInsert = async (status: string, channel: string, amount: number) => {
      try {
        await db.execute(sql`
          insert into pledge_increments (pledge_id, amount_minor, channel, status, reason)
          values (${first.pledgeId}::uuid, ${amount}, ${channel}, ${status}, 'verify')
        `);
        return false;
      } catch {
        return true;
      }
    };
    check("an administrator's increment cannot be held", await refusedInsert("held", "admin", 100));
    check("a negative increment cannot be held", await refusedInsert("held", "web", -100));
    check("a status outside the four is refused", await refusedInsert("pending", "web", 100));
    check("a confirmed row with nobody who confirmed it is refused", await refusedInsert("confirmed", "web", 100));

    // 5. The browser that made it.
    heading("5. an addition from the browser that made the pledge");
    const owned = await pledges.create(db, {
      input: { ...base, fullName: "Ruth Achieng Odhiambo", phone, amountKes: 50_000 },
      campaignSlug: CAMPAIGN_SLUG,
      ownership: { ownedPledgeIds: [first.pledgeId] },
    });
    check(
      "applies at once, on the same reference",
      !("held" in owned) && owned.isAddition && owned.reference === first.reference,
    );
    check(
      "and the amount is the applied sum, with the held addition still left out",
      !("held" in owned) && owned.amountMinor === 25_000_000n,
      !("held" in owned) ? owned.amountMinor.toString() : "held",
    );

    // 6. Ownership never stops a new pledge.
    heading("6. a first pledge from a new number");
    const fresh = await pledges.create(db, {
      input: { ...base, fullName: "New Comer", phone: newcomer, amountKes: 10_000 },
      campaignSlug: CAMPAIGN_SLUG,
      ownership: { ownedPledgeIds: [] },
    });
    check("is recorded as a pledge, not held", !("held" in fresh) && !fresh.isAddition);

    // 7. The trusted path.
    heading("7. the treasurer's path still adds directly");
    const desk = await pledges.create(db, {
      input: { ...base, fullName: "Ruth Achieng Odhiambo", phone, amountKes: 10_000 },
      campaignSlug: CAMPAIGN_SLUG,
      channel: "admin",
      ownership: { ownedPledgeIds: [] },
    });
    check("an admin channel addition applies", !("held" in desk) && desk.amountMinor === 26_000_000n);

    // 8. The journal.
    heading("8. the journal");
    const journal = await db.execute(sql`
      select after ->> 'addedMinor' as added, after ->> 'reference' as reference
      from audit_log
      where action = 'pledge.addition_held' and entity_id = ${first.pledgeId}::uuid
    `);
    show(journal.rows as Record<string, unknown>[]);
    check("a pledge.addition_held row was written", journal.rows.length === 1);
    check("with a tone", "pledge.addition_held" in AUDIT_TONES);
    const line = summarise("pledge.addition_held", null, { reference: first.reference, addedMinor: "900000000" });
    check("and a detail line", line === `${first.reference}, KES 9,000,000 held for confirmation`, line);

    // 8b. Who is emailed about a held addition.
    heading("8b. the notice goes only to the address on record, at most three a day");
    const { renderAdditionHeldNotice } = await import("@/server/email/held-addition");
    const owner = await pledges.create(db, {
      input: { ...base, fullName: "Grace Wanjiku Kamau", phone: noticed, email: RECORD_EMAIL, amountKes: 100_000 },
      campaignSlug: CAMPAIGN_SLUG,
    });
    const addAs = async (fullName: string, email: string) => {
      const r = await pledges.create(db, {
        input: { ...base, fullName, phone: noticed, email, amountKes: 5_000 },
        campaignSlug: CAMPAIGN_SLUG,
        ownership: { ownedPledgeIds: [] },
      });
      if (!("held" in r)) throw new Error("expected held");
      return r;
    };

    const stranger = await addAs("Mallory visit http://evil.example", "stranger@example.test");
    check(
      "a different typed address is sent nothing; the notice goes to the record",
      stranger.notice?.to === RECORD_EMAIL,
      stranger.notice?.to ?? "no notice",
    );

    const matching = await addAs("Grace", "  NOTICED.Pledger@Example.TEST ");
    check(
      "a typed address matching the record, ignoring case and spaces, gets exactly one notice",
      matching.notice?.to === RECORD_EMAIL,
      matching.notice?.to ?? "no notice",
    );

    const message = renderAdditionHeldNotice({
      fullName: stranger.notice!.fullName,
      reference: stranger.notice!.reference,
      addedMinor: stranger.addedMinor,
      siteUrl: "https://pledge.example.test",
    });
    check(
      "the notice carries nothing the submitter typed",
      !/Mallory|evil.example|stranger@/.test(message.text + message.html) &&
        message.text.includes("Dear Grace,") &&
        message.text.includes(owner.reference),
    );

    const third = await addAs("Somebody", "someone@example.test");
    check("the third notice in a day is sent", third.notice !== null);

    const fourth = await addAs("Somebody", "someone@example.test");
    const fourthRow = await db.execute(sql`
      select count(*)::int as held from pledge_increments
      where pledge_id = ${owner.pledgeId}::uuid and status = 'held'
    `);
    check("the fourth inside 24 hours is skipped", fourth.notice === null);
    check(
      "while the addition itself is still recorded and held",
      (fourthRow.rows[0] as { held: number }).held === 4,
      `${(fourthRow.rows[0] as { held: number }).held} held`,
    );

    // 9. The verification query, after everything above.
    heading("9. verification query: every pledge balances against its applied increments");
    const final = await db.execute(sql`
      select count(*)::int as pledges,
             count(*) filter (where p.amount_minor <> coalesce((select sum(i.amount_minor)
               from pledge_increments i where i.pledge_id = p.id and i.status = 'applied'), 0))::int as unbalanced,
             (select count(*)::int from pledge_increments where status = 'held') as held_on_branch
      from pledges p
    `);
    show(final.rows as Record<string, unknown>[]);
    check("still none unbalanced", (final.rows[0] as { unbalanced: number }).unbalanced === 0);
  } finally {
    heading("10. cleanup");
    await cleanup();
  }

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
