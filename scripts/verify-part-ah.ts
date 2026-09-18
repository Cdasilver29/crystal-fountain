import { config } from "dotenv";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Withdrawing display consent, session C3a.
 *
 * The one thing in the change request feature that does not queue. Under the
 * Data Protection Act withdrawing consent has to be as easy as giving it, and
 * giving it was one unticked checkbox on the pledge form, so this proves the
 * whole of it: the pair is enough, nobody approves it, the name is gone from
 * the public surfaces immediately, and the journal records that it happened
 * without recording the name.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:consent-withdrawal
 *
 * Everything is read back with SQL rather than from what the route claims it
 * did. Everything it creates is removed at the start and at the end, apart
 * from audit_log rows, which are append only by design.
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const CAMPAIGN_SLUG = "crystal-fountain";
const PHONES = {
  listed: "0799900091",
  quiet: "0799900092",
  other: "0799900093",
};
const NAMES = {
  listed: "Tabitha Wairimu",
  quiet: "Silent Giver",
  other: "Someone Else",
};

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
  const publicPledgers = await import("@/server/services/public-pledgers");
  const { summarise } = await import("@/server/services/audit");
  const { AUDIT_TONES } = await import("@/components/admin/audit-table");
  const { normalizeKenyanPhone } = await import("@/server/contracts/phone");
  const { AUDIT_FILTER_PREFIXES } = await import("@/server/contracts/admin");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(
      `${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`,
    );
  };

  const e164 = Object.fromEntries(
    Object.entries(PHONES).map(([k, v]) => [k, normalizeKenyanPhone(v)!]),
  ) as Record<keyof typeof PHONES, string>;
  const allPhones = sql.join(
    Object.values(e164).map((p) => sql`${p}`),
    sql`, `,
  );

  const cleanup = async () => {
    await db.execute(sql`
      delete from pledges where pledger_id in (
        select id from pledgers where phone_e164 in (${allPhones})
      )
    `);
    await db.execute(sql`
      delete from pledgers where phone_e164 in (${allPhones})
    `);
  };

  await cleanup();

  const makePledge = async (
    key: keyof typeof PHONES,
    displayConsent: boolean,
  ) => {
    // The phone arrives normalised: calling the service directly skips the
    // contract, and the contract is what normalises it.
    const made = await pledges.create(db, {
      input: {
        fullName: NAMES[key],
        phone: e164[key],
        intent: "one_off" as const,
        amountKes: 250_000,
        recordConsent: true as const,
        contactConsent: false,
        displayConsent,
      },
      campaignSlug: CAMPAIGN_SLUG,
    });
    // Only a verified pledge appears on the public list.
    await pledges.approve(db, { pledgeId: made.pledgeId, adminId: null });
    return made;
  };

  const withdraw = async (reference: string, phone: string) => {
    const response = await fetch(`${BASE}/api/redeem/display-consent`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reference, phone }),
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  };

  const lookup = async (reference: string, phone: string) => {
    const response = await fetch(`${BASE}/api/redeem/lookup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reference, phone }),
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  };

  const onPublicList = async (name: string) => {
    const page = await publicPledgers.publicList(db, {
      campaignSlug: CAMPAIGN_SLUG,
      limit: 200,
    });
    return page.items.some((row) => row.displayName.startsWith(name.split(" ")[0]));
  };

  /* -----------------------------------------------------------------------
   * 1. A name that is on the list.
   * --------------------------------------------------------------------- */

  heading("1. a pledger who agreed to be named");

  const listed = await makePledge("listed", true);
  const quiet = await makePledge("quiet", false);
  const other = await makePledge("other", true);

  const stored = await db.execute(sql`
    select g.full_name, g.display_name, g.display_consent
    from pledgers g where g.phone_e164 = ${e164.listed}
  `);
  show(stored.rows as Record<string, unknown>[]);
  const before = stored.rows[0] as {
    display_name: string;
    display_consent: boolean;
  };
  check("their consent is recorded", before.display_consent === true);
  check("and their name is stored for display", before.display_name === NAMES.listed);
  check(
    "and they are on the public list",
    await onPublicList(NAMES.listed),
  );

  const found = await lookup(listed.reference, PHONES.listed);
  check(
    "the lookup tells the page their name is published",
    found.body?.pledge?.displayConsent === true,
  );

  const quietLookup = await lookup(quiet.reference, PHONES.quiet);
  check(
    "and tells it the opposite for somebody who never agreed",
    quietLookup.body?.pledge?.displayConsent === false,
  );

  /* -----------------------------------------------------------------------
   * 2. Withdrawing it.
   * --------------------------------------------------------------------- */

  heading("2. withdrawing, with nobody's approval");

  const removed = await withdraw(listed.reference, PHONES.listed);
  show([{ status: removed.status, ...removed.body }]);
  check("the request is accepted", removed.status === 200);
  check("it found the pledge", removed.body?.found === true);
  check("and it changed something", removed.body?.changed === true);

  const after = await db.execute(sql`
    select g.full_name, g.display_name, g.display_consent
    from pledgers g where g.phone_e164 = ${e164.listed}
  `);
  show(after.rows as Record<string, unknown>[]);
  const now = after.rows[0] as {
    full_name: string;
    display_name: string | null;
    display_consent: boolean;
  };
  check("the consent flag is off", now.display_consent === false);
  /*
   * The name is cleared as well as the flag, so the row is indistinguishable
   * from a pledger who never consented. Leaving it would be keeping a copy of
   * exactly the thing they asked to have removed.
   */
  check("the display name is cleared too", now.display_name === null);
  check(
    "but the pledge's own record of who they are is untouched",
    now.full_name === NAMES.listed,
  );

  check(
    "they are off the public list immediately",
    (await onPublicList(NAMES.listed)) === false,
  );

  const stillThere = await db.execute(sql`
    select p.status, p.amount_minor::text as amount_minor
    from pledges p where p.id = ${listed.pledgeId}::uuid
  `);
  const pledge = stillThere.rows[0] as {
    status: string;
    amount_minor: string;
  };
  check("the pledge still stands", pledge.status === "verified");
  check("and still counts for its full amount", pledge.amount_minor === "25000000");

  /* -----------------------------------------------------------------------
   * 3. Nobody else's name.
   * --------------------------------------------------------------------- */

  heading("3. the pair is the authentication");

  const mismatched = await withdraw(other.reference, PHONES.listed);
  check(
    "a real reference with the wrong number changes nothing",
    mismatched.status === 200 && mismatched.body?.found === false,
    `${mismatched.status} found=${mismatched.body?.found}`,
  );
  check(
    "and says the same thing a failed lookup says, naming neither half",
    mismatched.body?.changed === false,
  );
  check(
    "the other pledger is still listed",
    await onPublicList(NAMES.other),
  );

  const nonsense = await withdraw("CF26-999999", PHONES.other);
  check(
    "a reference that does not exist is refused the same way",
    nonsense.status === 200 && nonsense.body?.found === false,
  );

  const malformed = await withdraw("not-a-reference", PHONES.other);
  check(
    "a malformed reference is a validation error, not a 500",
    malformed.status === 422,
    String(malformed.status),
  );

  /* -----------------------------------------------------------------------
   * 4. Pressing it twice.
   * --------------------------------------------------------------------- */

  heading("4. pressing it twice");

  const again = await withdraw(listed.reference, PHONES.listed);
  check("a second withdrawal is accepted", again.status === 200);
  check("it still finds the pledge", again.body?.found === true);
  check(
    "but reports that it changed nothing",
    again.body?.changed === false,
  );

  const rows = await db.execute(sql`
    select count(*)::int as n from audit_log
    where action = 'pledgers.display_consent_withdrawn'
      and after->>'reference' = ${listed.reference}
  `);
  check(
    "and wrote no second journal row, because nothing happened",
    (rows.rows[0] as { n: number }).n === 1,
    `${(rows.rows[0] as { n: number }).n} row(s)`,
  );

  /*
   * Somebody who never consented can press it too, harmlessly. The control is
   * not offered to them, but the endpoint is open to anybody with the pair.
   */
  const neverConsented = await withdraw(quiet.reference, PHONES.quiet);
  check(
    "somebody who never agreed gets found, unchanged",
    neverConsented.body?.found === true &&
      neverConsented.body?.changed === false,
  );

  /* -----------------------------------------------------------------------
   * 5. The journal.
   * --------------------------------------------------------------------- */

  heading("5. what the journal kept, and what it did not");

  const entry = await db.execute(sql`
    select actor_type, entity, before, after
    from audit_log
    where action = 'pledgers.display_consent_withdrawn'
      and after->>'reference' = ${listed.reference}
    limit 1
  `);
  const row = entry.rows[0] as {
    actor_type: string;
    entity: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  };
  show([
    {
      actor_type: row.actor_type,
      entity: row.entity,
      before: JSON.stringify(row.before),
      after: JSON.stringify(row.after),
    },
  ]);
  check("it is recorded as a public action", row.actor_type === "public");
  check("against the pledger", row.entity === "pledger");
  check("with the consent flag on both sides", row.before?.displayConsent === true);
  check("saying the name was cleared", row.after?.displayNameCleared === true);
  /*
   * The name itself is not in the payload. Every other row in this journal
   * names a pledge rather than a person, and copying somebody's name into an
   * append only record at the moment they ask to stop having it published
   * would be a strange way to honour the request.
   */
  check(
    "and no name anywhere in it",
    !JSON.stringify(row).includes(NAMES.listed) &&
      !JSON.stringify(row).includes("Tabitha"),
  );

  check(
    "the action has a colour of its own",
    AUDIT_TONES["pledgers.display_consent_withdrawn"] === "grey",
  );
  check(
    "and a detail line a person can read",
    summarise("pledgers.display_consent_withdrawn", null, {
      reference: "CF26-000124",
    }) === "CF26-000124, name removed from the public list",
    summarise("pledgers.display_consent_withdrawn", null, {
      reference: "CF26-000124",
    }),
  );
  /*
   * The action is plural, matching the organisation flag beside it, because
   * the Pledges filter on the audit screen matches "pledgers." and a singular
   * "pledger." would be invisible under the one filter anybody would look
   * under for it.
   */
  check(
    "and it falls under the pledges filter",
    AUDIT_FILTER_PREFIXES.pledges.some((prefix) =>
      "pledgers.display_consent_withdrawn".startsWith(prefix),
    ),
  );

  /* -----------------------------------------------------------------------
   * 6. The page offers it, and stops offering it.
   * --------------------------------------------------------------------- */

  heading("6. the control on the page");

  const page = await fetch(`${BASE}/redeem`);
  check("the redeem page still renders", page.status === 200);

  /*
   * The control cannot be in the first paint: it renders only once a lookup
   * has found a pledge whose name is published, which has not happened when
   * the page is served. So what is checked is that it was compiled into the
   * bundle the page loads, which is the part that would silently go missing if
   * the component were ever dropped from the tree.
   */
  const { readdir, readFile } = await import("node:fs/promises");
  const chunkDir = "./.next/static/chunks";
  const chunks = await readdir(chunkDir, { recursive: true }).catch(
    () => [] as string[],
  );

  let shipped = false;

  for (const name of chunks) {
    if (!name.endsWith(".js")) continue;
    const source = await readFile(`${chunkDir}/${name}`, "utf8").catch(() => "");
    if (source.includes("Remove my name from the public list")) {
      shipped = true;
      break;
    }
  }

  check(
    "and the control is in the bundle it loads, ready for a lookup to reveal it",
    shipped,
    `${chunks.length} chunks searched`,
  );

  const afterLookup = await lookup(listed.reference, PHONES.listed);
  check(
    "a pledger who has withdrawn is not offered it again",
    afterLookup.body?.pledge?.displayConsent === false,
  );

  /* -----------------------------------------------------------------------
   * 7. Cleanup.
   * --------------------------------------------------------------------- */

  heading("7. cleanup");

  await cleanup();

  const left = await db.execute(sql`
    select count(*)::int as n from pledgers where phone_e164 in (${allPhones})
  `);
  check(
    "nothing this suite wrote was left behind",
    (left.rows[0] as { n: number }).n === 0,
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
