import { config } from "dotenv";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * The member facing change request form and its route, session C3b.
 *
 * The pledger's half. C1 proved the table and the service, C2 proved the
 * queue and the decisions; this proves the only way a request ever gets made
 * in the first place: the public endpoint behind the /redeem pair, and the
 * page that decides whether to show a form or the state of what is already
 * waiting.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:change-form
 *
 * Everything is read back with SQL rather than from what the route claims it
 * did. Everything it creates is removed at the start and at the end, apart
 * from audit_log rows, which are append only by design.
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const CAMPAIGN_SLUG = "crystal-fountain";
const PHONES = {
  asking: "0799900101",
  second: "0799900102",
  limited: "0799900103",
};
const REASON = "My circumstances have changed and I need to adjust this.";

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
  const requests = await import("@/server/services/change-requests");
  const { normalizeKenyanPhone } = await import("@/server/contracts/phone");

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
      delete from pledge_change_requests where pledge_id in (
        select p.id from pledges p
        join pledgers g on g.id = p.pledger_id
        where g.phone_e164 in (${allPhones})
      )
    `);
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

  const makePledge = async (key: keyof typeof PHONES, amountKes: number) => {
    // The phone arrives normalised: calling the service directly skips the
    // contract, and the contract is what normalises it.
    const made = await pledges.create(db, {
      input: {
        fullName: "Form Test",
        phone: e164[key],
        intent: "one_off" as const,
        amountKes,
        recordConsent: true as const,
        contactConsent: false,
        displayConsent: false,
      },
      campaignSlug: CAMPAIGN_SLUG,
    });
    await pledges.approve(db, { pledgeId: made.pledgeId, adminId: null });
    return made;
  };

  const post = async (body: Record<string, unknown>) => {
    const response = await fetch(`${BASE}/api/redeem/change-requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    return { status: response.status, body: payload };
  };

  const lookup = async (reference: string, phone: string) => {
    const response = await fetch(`${BASE}/api/redeem/lookup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reference, phone }),
    });
    const payload = await response.json().catch(() => null);
    return { status: response.status, body: payload };
  };

  /* -----------------------------------------------------------------------
   * 1. Raising one through the endpoint.
   * --------------------------------------------------------------------- */

  heading("1. raising a request");

  const asking = await makePledge("asking", 500_000);

  const raised = await post({
    kind: "reduce_amount",
    reference: asking.reference,
    contactPhoneE164: PHONES.asking,
    reason: REASON,
    requestedAmountMinor: "30000000",
  });

  show([{ status: raised.status, ...raised.body, request: undefined }]);
  check("it is created", raised.status === 201, String(raised.status));
  check("and says so", raised.body?.outcome === "created");
  check("coming back pending", raised.body?.request?.status === "pending");

  const stored = await db.execute(sql`
    select r.kind,
           r.status,
           r.requested_amount_minor::text as requested_amount_minor,
           r.contact_phone_e164,
           r.source_ip::text as source_ip,
           p.amount_minor::text as pledge_amount_minor
    from pledge_change_requests r
    join pledges p on p.id = r.pledge_id
    where p.id = ${asking.pledgeId}::uuid
  `);
  show(stored.rows as Record<string, unknown>[]);
  const row = stored.rows[0] as {
    requested_amount_minor: string;
    contact_phone_e164: string;
    pledge_amount_minor: string;
  };
  check("with the amount that was asked for", row.requested_amount_minor === "30000000");
  check("and the number stored normalised", row.contact_phone_e164 === e164.asking);
  /*
   * The whole point of the feature. A pledger can ask; only an administrator
   * can answer.
   */
  check("and the pledge itself did not move", row.pledge_amount_minor === "50000000");

  /*
   * The response carries what the page needs and nothing else. The reason is
   * the pledger's own words, which they have just typed, and echoing personal
   * detail back for no reason is how it ends up somewhere it should not be.
   */
  const echoed = JSON.stringify(raised.body);
  check(
    "the response echoes no reason and no phone number",
    !echoed.includes("circumstances") && !echoed.includes(e164.asking.slice(4)),
  );

  /* -----------------------------------------------------------------------
   * 2. The lookup carries what is waiting.
   * --------------------------------------------------------------------- */

  heading("2. what the page is told");

  const found = await lookup(asking.reference, PHONES.asking);
  show([{ openRequest: JSON.stringify(found.body?.pledge?.openRequest) }]);
  check(
    "the lookup reports the open request",
    found.body?.pledge?.openRequest?.kind === "reduce_amount",
  );
  check(
    "with the date it was raised",
    typeof found.body?.pledge?.openRequest?.createdAt === "string",
  );
  check(
    "and not the reason, which is the pledger's own words",
    !JSON.stringify(found.body).includes("circumstances"),
  );

  const clean = await makePledge("second", 200_000);
  const noRequest = await lookup(clean.reference, PHONES.second);
  check(
    "a pledge with nothing waiting says so",
    noRequest.body?.pledge?.openRequest === null,
  );

  /* -----------------------------------------------------------------------
   * 3. One open request per pledge.
   * --------------------------------------------------------------------- */

  heading("3. a second request while one is open");

  const again = await post({
    kind: "cancel_pledge",
    reference: asking.reference,
    contactPhoneE164: PHONES.asking,
    reason: "I have changed my mind about the whole thing entirely.",
  });

  check(
    "it is accepted rather than refused",
    again.status === 200,
    String(again.status),
  );
  check(
    "and hands back the one already open",
    again.body?.outcome === "already_pending" &&
      again.body?.request?.kind === "reduce_amount",
  );

  const stillOne = await db.execute(sql`
    select count(*)::int as n from pledge_change_requests
    where pledge_id = ${asking.pledgeId}::uuid
  `);
  check(
    "and nothing second was written",
    (stillOne.rows[0] as { n: number }).n === 1,
  );

  /* -----------------------------------------------------------------------
   * 4. What the endpoint refuses.
   * --------------------------------------------------------------------- */

  heading("4. what it refuses");

  const wrongPair = await post({
    kind: "cancel_pledge",
    reference: clean.reference,
    contactPhoneE164: PHONES.asking,
    reason: "Trying somebody else's reference with my own number.",
  });
  check(
    "a mismatched pair is refused",
    wrongPair.status === 404 && wrongPair.body?.code === "pledge_not_found",
    `${wrongPair.status} ${wrongPair.body?.code}`,
  );

  const increase = await post({
    kind: "reduce_amount",
    reference: clean.reference,
    contactPhoneE164: PHONES.second,
    reason: "I would like to give rather more than I first said.",
    requestedAmountMinor: "50000000",
  });
  /*
   * 422 and not 409. The request was understood and refused, which is what
   * rejected() means here and what a failed bot check also returns. The
   * conflict code is reserved for approving a reduction the pledge has since
   * outgrown, where the clash really is with a state that moved underneath.
   */
  check(
    "an increase is refused, not queued",
    increase.status === 422 &&
      increase.body?.code === "reduction_not_a_reduction",
    `${increase.status} ${increase.body?.code}`,
  );
  check(
    "and the refusal points at the pledge form",
    String(increase.body?.title ?? "").includes("another pledge"),
  );

  const shortReason = await post({
    kind: "cancel_pledge",
    reference: clean.reference,
    contactPhoneE164: PHONES.second,
    reason: "no",
  });
  check(
    "a reason too short to act on is a validation error",
    shortReason.status === 422 && Boolean(shortReason.body?.errors?.reason),
    shortReason.body?.errors?.reason ?? String(shortReason.status),
  );

  const wrongFields = await post({
    kind: "correct_name",
    reference: clean.reference,
    contactPhoneE164: PHONES.second,
    reason: REASON,
    // A name correction carrying a payment reference. The contract strips it;
    // what matters is that nothing of the sort reaches the row.
    requestedName: "Jane Otieno",
    paymentReference: "QGH7X8K9LM",
  });
  check("a kind carrying another kind's field is accepted", wrongFields.status === 201);

  const strayField = await db.execute(sql`
    select payment_reference, requested_name
    from pledge_change_requests
    where pledge_id = ${clean.pledgeId}::uuid
  `);
  const stray = strayField.rows[0] as {
    payment_reference: string | null;
    requested_name: string;
  };
  check("with the stray field dropped on the way", stray.payment_reference === null);
  check("and its own field kept", stray.requested_name === "Jane Otieno");

  const nonsense = await fetch(`${BASE}/api/redeem/change-requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "not json",
  });
  check("a body that is not JSON is a 400", nonsense.status === 400);

  /* -----------------------------------------------------------------------
   * 5. The rate limit, through the endpoint.
   * --------------------------------------------------------------------- */

  heading("5. three a day, counted through the route");

  const limited = await makePledge("limited", 300_000);

  const decide = () =>
    db.execute(sql`
      update pledge_change_requests
      set status = 'declined', decided_at = now(),
          decided_by = (select id from admin_users order by created_at limit 1)
      where pledge_id = ${limited.pledgeId}::uuid and status = 'pending'
    `);

  const ask = (n: number) =>
    post({
      kind: "cancel_pledge",
      reference: limited.reference,
      contactPhoneE164: PHONES.limited,
      reason: `Attempt number ${n}, written out at length.`,
    });

  for (let n = 1; n <= 3; n += 1) {
    const result = await ask(n);
    check(`request ${n} is allowed`, result.status === 201, String(result.status));
    await decide();
  }

  const fourth = await ask(4);
  check(
    "the fourth inside the day is refused",
    fourth.status === 429 &&
      fourth.body?.code === "change_request_pledge_limited",
    `${fourth.status} ${fourth.body?.code}`,
  );

  /* -----------------------------------------------------------------------
   * 6. The page.
   * --------------------------------------------------------------------- */

  heading("6. the form on the page");

  const redeemPage = await fetch(`${BASE}/redeem`);
  check("the redeem page still renders", redeemPage.status === 200);

  /*
   * The form renders only once a lookup has found a pledge, so it cannot be in
   * the first paint. What is checked is that it was compiled into the bundle
   * the page loads, which is the part that would silently go missing if the
   * component were dropped from the tree.
   */
  const { readdir, readFile } = await import("node:fs/promises");
  const chunkDir = "./.next/static/chunks";
  const chunks = await readdir(chunkDir, { recursive: true }).catch(
    () => [] as string[],
  );

  const wanted = [
    "Ask for a change",
    "Send this to the treasurer",
    "waiting for the treasurer",
  ];
  const seen = new Set<string>();

  for (const name of chunks) {
    if (!name.endsWith(".js")) continue;
    const source = await readFile(`${chunkDir}/${name}`, "utf8").catch(() => "");
    for (const phrase of wanted) {
      if (source.includes(phrase)) seen.add(phrase);
    }
  }

  for (const phrase of wanted) {
    check(`the bundle carries "${phrase}"`, seen.has(phrase));
  }

  /* -----------------------------------------------------------------------
   * 7. The acknowledgement.
   * --------------------------------------------------------------------- */

  heading("7. who can be written to");

  /*
   * The emails are not sent from here: there is no API key in a verification
   * run and no inbox to read. What is checked is the thing that decides
   * whether a message can be sent at all, which is whether the pledger left an
   * address, and that the service carries it out to the caller who sends.
   */
  const withoutAddress = await requests.create(db, {
    input: (
      await import("@/server/contracts/change-requests")
    ).changeRequestInput.parse({
      kind: "cancel_pledge",
      reference: clean.reference,
      contactPhoneE164: PHONES.second,
      reason: "A second request, to read the recipient off the result.",
    }),
    campaignSlug: CAMPAIGN_SLUG,
    request: { ip: "198.51.100.51", userAgent: "verify-part-ai" },
  });

  show([
    {
      outcome: withoutAddress.outcome,
      reference: withoutAddress.reference,
      pledgerName: withoutAddress.pledger.name,
      hasEmail: withoutAddress.pledger.email !== null,
    },
  ]);
  check(
    "create hands back the reference for the acknowledgement",
    withoutAddress.reference === clean.reference,
  );
  check(
    "and who to write to",
    withoutAddress.pledger.name === "Form Test",
  );
  /*
   * The pledge form's email field is optional and this fixture left it blank,
   * which is the ordinary case rather than a failure. The caller skips the
   * send; the admin queue says so on the card.
   */
  check(
    "with a null address where the pledger gave none",
    withoutAddress.pledger.email === null,
  );

  const queue = await requests.listForAdmin(db, {
    campaignSlug: CAMPAIGN_SLUG,
    revealPhone: false,
    limit: 100,
  });
  const mine = queue.items.filter((r) => r.pledgeId === clean.pledgeId);
  check(
    "and the queue shows the treasurer there is nobody to email",
    mine.length > 0 && mine.every((r) => r.canEmail === false),
  );

  const page = await fetch(`${BASE}/admin/change-requests`, {
    redirect: "manual",
  });
  check(
    "the admin queue is still behind a sign in",
    page.status === 307 || page.status === 302,
    String(page.status),
  );

  /* -----------------------------------------------------------------------
   * 8. Cleanup.
   * --------------------------------------------------------------------- */

  heading("8. cleanup");

  const openBefore = await requests.countPending(db, {
    campaignSlug: CAMPAIGN_SLUG,
  });
  show([{ pendingBeforeCleanup: openBefore }]);

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
