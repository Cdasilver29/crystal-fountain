import { config } from "dotenv";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Pledge change requests, session C1.
 *
 * Proves the three things C1 exists to put in place: the table refuses a
 * malformed request for each of the five kinds, it refuses a second open
 * request for the same pledge, and the service records one, finds one and
 * counts the two rate limits off the requests themselves.
 *
 * Everything is read back with SQL rather than from what the service claims it
 * did. The malformed inserts go in as raw SQL on purpose: the contract would
 * refuse every one of them before they reached the database, and what is being
 * checked here is the database, which is the gate that holds whatever route a
 * row arrives by.
 *
 * Usage: pnpm db:verify:change-requests
 *
 * Nothing here decides anything. approve and decline are stubs until C2 and
 * this asserts that they still are.
 *
 * Everything it creates is removed at the start and at the end, apart from
 * audit_log rows, which are append only by design.
 */

const CAMPAIGN_SLUG = "crystal-fountain";
// Kenyan test range, and the same prefix the other verification suites claim,
// so a failed run never leaves rows that look like a real pledger.
const TEST_PHONE = "0799900051";
const OTHER_PHONE = "0799900052";
// TEST-NET-2, which is reserved for documentation and can never be a real
// visitor. Every row this suite writes carries one, so the sweep at the end
// can find them by address as well as by pledge.
const TEST_IP = "198.51.100.11";
const OTHER_IP = "198.51.100.12";
const IP_LIMIT_IP = "198.51.100.13";

const REASON = "My circumstances have changed and I need to adjust this.";

/**
 * The message postgres actually sent.
 *
 * The driver wraps every failure in a DrizzleQueryError whose own message is
 * only "Failed query:", so a refusal printed straight off the caught error says
 * nothing about why it was refused.
 */
function refusal(error: unknown): string {
  const cause = (error as { cause?: { message?: string; detail?: string } })
    .cause;
  return cause?.detail ?? cause?.message ?? String(error);
}

/** The constraint postgres named, when it named one. */
function constraintOf(error: unknown): string {
  const cause = (error as { cause?: { constraint?: string } }).cause;
  return cause?.constraint ?? "";
}

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
  const { summarise } = await import("@/server/services/audit");
  const { AUDIT_TONES, toneFor } = await import(
    "@/components/admin/audit-table"
  );
  const { can } = await import("@/lib/permissions");
  const { normalizeKenyanPhone } = await import("@/server/contracts/phone");
  const { changeRequestInput } = await import(
    "@/server/contracts/change-requests"
  );
  const { isServiceError } = await import("@/server/errors");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(
      `${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`,
    );
  };

  const phone = normalizeKenyanPhone(TEST_PHONE)!;
  const otherPhone = normalizeKenyanPhone(OTHER_PHONE)!;

  /*
   * A sweep at the start as well as the end. The per pledge limit is three a
   * day, so a run that died half way through would otherwise poison the next
   * one for twenty four hours.
   */
  const cleanup = async () => {
    await db.execute(sql`
      delete from pledge_change_requests
      where source_ip in (${TEST_IP}::inet, ${OTHER_IP}::inet, ${IP_LIMIT_IP}::inet)
         or pledge_id in (
           select p.id from pledges p
           join pledgers g on g.id = p.pledger_id
           where g.phone_e164 in (${phone}, ${otherPhone})
         )
    `);
    await db.execute(sql`
      delete from pledges
      where pledger_id in (
        select id from pledgers where phone_e164 in (${phone}, ${otherPhone})
      )
    `);
    await db.execute(sql`
      delete from pledgers where phone_e164 in (${phone}, ${otherPhone})
    `);
  };

  await cleanup();

  /* -----------------------------------------------------------------------
   * 1. The migration landed.
   * --------------------------------------------------------------------- */

  heading("1. the table, its indexes and its constraints");

  const columns = await db.execute(sql`
    select column_name, data_type, is_nullable
    from information_schema.columns
    where table_name = 'pledge_change_requests'
    order by ordinal_position
  `);
  show(columns.rows as Record<string, unknown>[]);
  check(
    "the table has all seventeen columns",
    columns.rows.length === 17,
    `${columns.rows.length} columns`,
  );

  const indexes = await db.execute(sql`
    select indexname, indexdef
    from pg_indexes
    where tablename = 'pledge_change_requests'
    order by indexname
  `);
  const indexNames = (indexes.rows as { indexname: string }[]).map(
    (r) => r.indexname,
  );
  show(indexes.rows as Record<string, unknown>[]);
  check(
    "the one pending partial unique index is there",
    indexNames.includes("pledge_change_requests_one_pending_idx"),
  );
  check(
    "the queue index on (status, created_at desc) is there",
    indexNames.includes("pledge_change_requests_status_created_idx"),
  );

  const constraints = await db.execute(sql`
    select conname
    from pg_constraint
    where conrelid = 'pledge_change_requests'::regclass
      and contype = 'c'
    order by conname
  `);
  const constraintNames = (constraints.rows as { conname: string }[]).map(
    (r) => r.conname,
  );
  show(constraints.rows as Record<string, unknown>[]);
  for (const kind of [
    "reduce_amount",
    "change_plan",
    "correct_name",
    "payment_missing",
    "cancel_pledge",
  ]) {
    check(
      `there is a check constraint for ${kind}`,
      constraintNames.includes(`pledge_change_requests_${kind}_check`),
    );
  }

  /* -----------------------------------------------------------------------
   * 2. A pledge to hang the requests off.
   * --------------------------------------------------------------------- */

  heading("2. a pledge to ask about");

  const pledge = await pledges.create(db, {
    input: {
      fullName: "Change Request Test",
      phone,
      intent: "one_off" as const,
      amountKes: 500_000,
      recordConsent: true as const,
      contactConsent: false,
      displayConsent: false,
    },
    campaignSlug: CAMPAIGN_SLUG,
  });

  const other = await pledges.create(db, {
    input: {
      fullName: "Second Requester",
      phone: otherPhone,
      intent: "one_off" as const,
      amountKes: 200_000,
      recordConsent: true as const,
      contactConsent: false,
      displayConsent: false,
    },
    campaignSlug: CAMPAIGN_SLUG,
  });

  show([
    { reference: pledge.reference, amountMinor: pledge.amountMinor },
    { reference: other.reference, amountMinor: other.amountMinor },
  ]);
  check("a pledge to ask about exists", pledge.amountMinor === 50_000_000n);

  /* -----------------------------------------------------------------------
   * 3. The database refuses a malformed request, per kind.
   * --------------------------------------------------------------------- */

  heading("3. the database refuses a malformed request, per kind");

  /** One raw insert, bypassing the contract entirely. */
  const rawInsert = (fields: {
    kind: string;
    requestedAmountMinor?: bigint | null;
    requestedFrequency?: string | null;
    requestedName?: string | null;
    paymentReference?: string | null;
    paymentAmountMinor?: bigint | null;
    paymentPaidOn?: string | null;
    reason?: string;
    status?: string;
    pledgeId?: string;
  }) =>
    db.execute(sql`
      insert into pledge_change_requests
        (pledge_id, kind, requested_amount_minor, requested_frequency,
         requested_name, payment_reference, payment_amount_minor,
         payment_paid_on, reason, contact_phone_e164, status, source_ip)
      values (
        ${fields.pledgeId ?? pledge.pledgeId}::uuid,
        ${fields.kind},
        ${fields.requestedAmountMinor?.toString() ?? null}::bigint,
        ${fields.requestedFrequency ?? null},
        ${fields.requestedName ?? null},
        ${fields.paymentReference ?? null},
        ${fields.paymentAmountMinor?.toString() ?? null}::bigint,
        ${fields.paymentPaidOn ?? null}::date,
        ${fields.reason ?? REASON},
        ${phone},
        ${fields.status ?? "pending"},
        ${TEST_IP}::inet
      )
    `);

  /** Asserts that an insert is refused, and by which constraint. */
  const refuses = async (
    label: string,
    expected: string,
    fields: Parameters<typeof rawInsert>[0],
  ) => {
    try {
      await rawInsert(fields);
      check(label, false, "the insert was accepted");
      // Take it straight back out, so a wrongly accepted row cannot go on to
      // hold the pending index and fail every later check for the wrong reason.
      await db.execute(sql`
        delete from pledge_change_requests where source_ip = ${TEST_IP}::inet
      `);
    } catch (error) {
      const constraint = constraintOf(error);
      check(label, constraint === expected, constraint || refusal(error));
    }
  };

  await refuses(
    "a reduce_amount with no amount is refused",
    "pledge_change_requests_reduce_amount_check",
    { kind: "reduce_amount" },
  );

  await refuses(
    "a reduce_amount carrying a payment reference is refused",
    "pledge_change_requests_reduce_amount_check",
    {
      kind: "reduce_amount",
      requestedAmountMinor: 40_000_000n,
      paymentReference: "QGH7X8K9LM",
    },
  );

  await refuses(
    "a change_plan with no frequency is refused",
    "pledge_change_requests_change_plan_check",
    { kind: "change_plan" },
  );

  await refuses(
    "a change_plan carrying an amount is refused",
    "pledge_change_requests_change_plan_check",
    {
      kind: "change_plan",
      requestedFrequency: "monthly",
      requestedAmountMinor: 40_000_000n,
    },
  );

  await refuses(
    "a change_plan with a frequency the pledge column would not take is refused",
    "pledge_change_requests_frequency_check",
    { kind: "change_plan", requestedFrequency: "weekly" },
  );

  await refuses(
    "a correct_name with no name is refused",
    "pledge_change_requests_correct_name_check",
    { kind: "correct_name" },
  );

  await refuses(
    "a correct_name carrying a payment reference is refused",
    "pledge_change_requests_correct_name_check",
    {
      kind: "correct_name",
      requestedName: "Jane Otieno",
      paymentReference: "QGH7X8K9LM",
    },
  );

  await refuses(
    "a payment_missing with no date is refused",
    "pledge_change_requests_payment_missing_check",
    {
      kind: "payment_missing",
      paymentReference: "QGH7X8K9LM",
      paymentAmountMinor: 500_000n,
    },
  );

  await refuses(
    "a payment_missing carrying a requested name is refused",
    "pledge_change_requests_payment_missing_check",
    {
      kind: "payment_missing",
      paymentReference: "QGH7X8K9LM",
      paymentAmountMinor: 500_000n,
      paymentPaidOn: "2026-09-01",
      requestedName: "Jane Otieno",
    },
  );

  await refuses(
    "a cancel_pledge carrying an amount is refused",
    "pledge_change_requests_cancel_pledge_check",
    { kind: "cancel_pledge", requestedAmountMinor: 40_000_000n },
  );

  await refuses(
    "a kind nobody has heard of is refused",
    "pledge_change_requests_kind_check",
    { kind: "change_phone" },
  );

  await refuses(
    "a reason too short to act on is refused",
    "pledge_change_requests_reason_check",
    { kind: "cancel_pledge", reason: "no" },
  );

  await refuses(
    "a pending request carrying a decision is refused",
    "pledge_change_requests_decision_check",
    { kind: "cancel_pledge", status: "approved" },
  );

  /* -----------------------------------------------------------------------
   * 4. The service records one.
   * --------------------------------------------------------------------- */

  heading("4. recording a request");

  const input = changeRequestInput.parse({
    kind: "reduce_amount",
    reference: pledge.reference,
    contactPhoneE164: TEST_PHONE,
    reason: REASON,
    requestedAmountMinor: "30000000",
  });

  const created = await requests.create(db, {
    input,
    campaignSlug: CAMPAIGN_SLUG,
    request: { ip: TEST_IP, userAgent: "verify-part-ae" },
  });

  show([
    {
      outcome: created.outcome,
      kind: created.request.kind,
      status: created.request.status,
      requestedAmountMinor: created.request.requestedAmountMinor,
    },
  ]);
  check("the request was created", created.outcome === "created");
  check("it lands pending", created.request.status === "pending");
  check(
    "it carries the amount that was asked for",
    created.request.requestedAmountMinor === 30_000_000n,
  );

  const stored = await db.execute(sql`
    select r.kind,
           r.status,
           r.requested_amount_minor::text as requested_amount_minor,
           r.contact_phone_e164,
           r.source_ip::text as source_ip,
           p.amount_minor::text as pledge_amount_minor
    from pledge_change_requests r
    join pledges p on p.id = r.pledge_id
    where r.id = ${created.request.id}::uuid
  `);
  show(stored.rows as Record<string, unknown>[]);
  const storedRow = stored.rows[0] as {
    contact_phone_e164: string;
    pledge_amount_minor: string;
  };
  check(
    "the contact number was stored normalised",
    storedRow.contact_phone_e164 === phone,
  );
  check(
    "the pledge itself did not move",
    storedRow.pledge_amount_minor === "50000000",
  );

  /* -----------------------------------------------------------------------
   * 5. One open request per pledge.
   * --------------------------------------------------------------------- */

  heading("5. one open request per pledge");

  const again = await requests.create(db, {
    input: changeRequestInput.parse({
      kind: "cancel_pledge",
      reference: pledge.reference,
      contactPhoneE164: TEST_PHONE,
      reason: "I have changed my mind about the whole thing.",
    }),
    campaignSlug: CAMPAIGN_SLUG,
    request: { ip: TEST_IP, userAgent: "verify-part-ae" },
  });

  check(
    "a second request comes back as the one already open",
    again.outcome === "already_pending",
  );
  check(
    "and it is the same request, not a new one",
    again.request.id === created.request.id,
  );
  check(
    "the second request was not recorded",
    again.request.kind === "reduce_amount",
  );

  // The index itself, underneath the service that is being polite about it.
  try {
    await rawInsert({ kind: "cancel_pledge" });
    check("the database refuses a second pending request", false, "accepted");
    await db.execute(sql`
      delete from pledge_change_requests
      where source_ip = ${TEST_IP}::inet and kind = 'cancel_pledge'
    `);
  } catch (error) {
    check(
      "the database refuses a second pending request",
      constraintOf(error) === "pledge_change_requests_one_pending_idx",
      constraintOf(error) || refusal(error),
    );
  }

  const pending = await requests.getPendingForPledge(db, {
    pledgeId: pledge.pledgeId,
  });
  check(
    "getPendingForPledge finds it",
    pending?.id === created.request.id,
    pending?.kind ?? "none",
  );

  /* -----------------------------------------------------------------------
   * 6. An increase is refused rather than queued.
   * --------------------------------------------------------------------- */

  heading("6. an increase is refused, not queued");

  try {
    await requests.create(db, {
      input: changeRequestInput.parse({
        kind: "reduce_amount",
        reference: other.reference,
        contactPhoneE164: OTHER_PHONE,
        reason: "I would like to give rather more than I first said.",
        // The other pledge stands at KES 200,000.
        requestedAmountMinor: "30000000",
      }),
      campaignSlug: CAMPAIGN_SLUG,
      request: { ip: OTHER_IP, userAgent: "verify-part-ae" },
    });
    check("an increase is refused", false, "it was accepted");
  } catch (error) {
    const service = isServiceError(error) ? error : null;
    check(
      "an increase is refused",
      service?.code === "reduction_not_a_reduction",
      service?.message ?? String(error),
    );
    check(
      "and the refusal points at the pledge form",
      Boolean(service?.message.includes("another pledge")),
    );
  }

  const openOnOther = await requests.getPendingForPledge(db, {
    pledgeId: other.pledgeId,
  });
  check("nothing was queued for it", openOnOther === null);

  /* -----------------------------------------------------------------------
   * 7. A pledge that is not there, and one that is closed.
   * --------------------------------------------------------------------- */

  heading("7. the pairing is the authentication");

  try {
    await requests.create(db, {
      input: changeRequestInput.parse({
        kind: "cancel_pledge",
        reference: pledge.reference,
        // A real reference with somebody else's number.
        contactPhoneE164: OTHER_PHONE,
        reason: "Trying somebody else's reference with my own number.",
      }),
      campaignSlug: CAMPAIGN_SLUG,
      request: { ip: OTHER_IP, userAgent: "verify-part-ae" },
    });
    check("a mismatched pair is refused", false, "it was accepted");
  } catch (error) {
    const service = isServiceError(error) ? error : null;
    check(
      "a mismatched pair is refused",
      service?.code === "pledge_not_found",
      service?.code ?? String(error),
    );
  }

  await db.execute(sql`
    update pledges set status = 'cancelled', cancelled_at = now()
    where id = ${other.pledgeId}::uuid
  `);

  try {
    await requests.create(db, {
      input: changeRequestInput.parse({
        kind: "cancel_pledge",
        reference: other.reference,
        contactPhoneE164: OTHER_PHONE,
        reason: "Asking about a pledge that is already cancelled.",
      }),
      campaignSlug: CAMPAIGN_SLUG,
      request: { ip: OTHER_IP, userAgent: "verify-part-ae" },
    });
    check("a cancelled pledge takes no requests", false, "it was accepted");
  } catch (error) {
    const service = isServiceError(error) ? error : null;
    check(
      "a cancelled pledge takes no requests",
      service?.code === "pledge_not_changeable",
      service?.code ?? String(error),
    );
  }

  /* -----------------------------------------------------------------------
   * 8. The rate limits, counted off the requests themselves.
   * --------------------------------------------------------------------- */

  heading("8. the rate limits");

  check(
    "three per pledge per day",
    requests.CHANGE_REQUEST_PLEDGE_LIMIT === 3 &&
      requests.CHANGE_REQUEST_PLEDGE_WINDOW_SECONDS === 86_400,
  );
  check(
    "ten per address per hour",
    requests.CHANGE_REQUEST_IP_LIMIT === 10 &&
      requests.CHANGE_REQUEST_IP_WINDOW_SECONDS === 3_600,
  );

  /*
   * The pledge limit, reached without waiting a day. The open request is
   * decided out of the way each time, because the one pending index would
   * otherwise stop the second attempt before the limit could.
   */
  const decideOpen = () =>
    db.execute(sql`
      update pledge_change_requests
      set status = 'declined', decided_at = now(),
          decided_by = (select id from admin_users order by created_at limit 1)
      where pledge_id = ${pledge.pledgeId}::uuid and status = 'pending'
    `);

  const raise = (n: number) =>
    requests.create(db, {
      input: changeRequestInput.parse({
        kind: "cancel_pledge",
        reference: pledge.reference,
        contactPhoneE164: TEST_PHONE,
        reason: `Attempt number ${n}, written out at length.`,
      }),
      campaignSlug: CAMPAIGN_SLUG,
      request: { ip: TEST_IP, userAgent: "verify-part-ae" },
    });

  await decideOpen();
  const second = await raise(2);
  check("a second request on the same pledge is allowed", second.outcome === "created");

  await decideOpen();
  const third = await raise(3);
  check("a third is allowed", third.outcome === "created");

  await decideOpen();
  try {
    await raise(4);
    check("a fourth inside the day is refused", false, "it was accepted");
  } catch (error) {
    const service = isServiceError(error) ? error : null;
    check(
      "a fourth inside the day is refused",
      service?.code === "change_request_pledge_limited",
      service?.code ?? String(error),
    );
  }

  const counted = await db.execute(sql`
    select count(*)::int as n
    from pledge_change_requests
    where pledge_id = ${pledge.pledgeId}::uuid
      and created_at > now() - make_interval(secs => 86400)
  `);
  show(counted.rows as Record<string, unknown>[]);
  check(
    "the limit counted the rows themselves, and there are three",
    (counted.rows[0] as { n: number }).n === 3,
  );

  /*
   * The address limit. Ten rows already on the same address, planted directly
   * so the pledge limit does not fire first, and then one attempt through the
   * service from a pledge that has none of its own.
   */
  await db.execute(sql`
    update pledges set status = 'pending', cancelled_at = null
    where id = ${other.pledgeId}::uuid
  `);

  await db.execute(sql`
    insert into pledge_change_requests
      (pledge_id, kind, reason, contact_phone_e164, status, decided_at,
       decided_by, source_ip)
    select ${other.pledgeId}::uuid,
           'cancel_pledge',
           ${REASON},
           ${otherPhone},
           'declined',
           now(),
           (select id from admin_users order by created_at limit 1),
           ${IP_LIMIT_IP}::inet
    from generate_series(1, ${requests.CHANGE_REQUEST_IP_LIMIT})
  `);

  try {
    await requests.create(db, {
      input: changeRequestInput.parse({
        kind: "cancel_pledge",
        reference: other.reference,
        contactPhoneE164: OTHER_PHONE,
        reason: "One more from an address that has had its ten already.",
      }),
      campaignSlug: CAMPAIGN_SLUG,
      request: { ip: IP_LIMIT_IP, userAgent: "verify-part-ae" },
    });
    check("an eleventh from one address in the hour is refused", false, "accepted");
  } catch (error) {
    const service = isServiceError(error) ? error : null;
    check(
      "an eleventh from one address in the hour is refused",
      service?.code === "change_request_ip_limited",
      service?.code ?? String(error),
    );
  }

  /* -----------------------------------------------------------------------
   * 9. The admin queue.
   * --------------------------------------------------------------------- */

  heading("9. the queue the treasurer reads");

  const queue = await requests.listForAdmin(db, {
    campaignSlug: CAMPAIGN_SLUG,
    revealPhone: true,
    limit: 50,
  });
  const mine = queue.items.filter(
    (row) => row.pledgeId === pledge.pledgeId || row.pledgeId === other.pledgeId,
  );
  show(
    mine.slice(0, 5).map((row) => ({
      kind: row.kind,
      status: row.status,
      reference: row.reference,
      pledgerName: row.pledgerName,
      currentAmountMinor: row.currentAmountMinor,
      requestedAmountMinor: row.requestedAmountMinor,
      contactPhone: row.contactPhone,
    })),
  );
  check("the queue returns this run's requests", mine.length > 0);
  check(
    "each row carries the pledge reference and the pledger",
    mine.every((row) => row.reference !== "" && row.pledgerName !== ""),
  );
  check(
    "and the pledge's current amount, so a decision can be read against it",
    mine.every((row) => row.currentAmountMinor > 0n),
  );
  check(
    "a treasurer sees the whole phone number",
    mine.every((row) => row.contactPhone.startsWith("+254")),
  );

  const masked = await requests.listForAdmin(db, {
    campaignSlug: CAMPAIGN_SLUG,
    revealPhone: false,
    limit: 50,
  });
  const maskedMine = masked.items.filter(
    (row) => row.pledgeId === pledge.pledgeId || row.pledgeId === other.pledgeId,
  );
  check(
    "a viewer sees it masked to the last three digits",
    maskedMine.length > 0 && maskedMine.every((row) => row.contactPhone.includes("•")),
    maskedMine[0]?.contactPhone ?? "none",
  );
  check(
    "and no whole number reaches a viewer at all",
    maskedMine.every((row) => !row.contactPhone.includes(phone.slice(4))),
  );

  const byKind = await requests.listForAdmin(db, {
    campaignSlug: CAMPAIGN_SLUG,
    revealPhone: false,
    kind: "reduce_amount",
    limit: 50,
  });
  check(
    "the kind filter returns only that kind",
    byKind.items.every((row) => row.kind === "reduce_amount"),
  );

  const byStatus = await requests.listForAdmin(db, {
    campaignSlug: CAMPAIGN_SLUG,
    revealPhone: false,
    status: "declined",
    limit: 50,
  });
  check(
    "the status filter returns only that status",
    byStatus.items.every((row) => row.status === "declined"),
  );

  const firstPage = await requests.listForAdmin(db, {
    campaignSlug: CAMPAIGN_SLUG,
    revealPhone: false,
    limit: 1,
  });
  check("a page of one is a page of one", firstPage.items.length === 1);
  if (firstPage.hasMore) {
    const secondPage = await requests.listForAdmin(db, {
      campaignSlug: CAMPAIGN_SLUG,
      revealPhone: false,
      limit: 1,
      cursor: firstPage.nextCursor,
    });
    check(
      "the cursor moves on rather than repeating",
      secondPage.items[0]?.id !== firstPage.items[0]?.id,
    );
  }

  /* -----------------------------------------------------------------------
   * 10. The journal.
   * --------------------------------------------------------------------- */

  heading("10. the audit trail");

  const trail = await db.execute(sql`
    select action, actor_type, entity, after
    from audit_log
    where entity_id = ${pledge.pledgeId}::uuid
      and action = 'pledge.change_requested'
    order by at desc
  `);
  show(
    (trail.rows as { action: string; actor_type: string; entity: string }[]).map(
      (r) => ({ action: r.action, actor_type: r.actor_type, entity: r.entity }),
    ),
  );
  check(
    "every recorded request wrote a row",
    trail.rows.length === 3,
    `${trail.rows.length} rows`,
  );
  check(
    "written as a public action, because a member did it",
    (trail.rows as { actor_type: string }[]).every(
      (r) => r.actor_type === "public",
    ),
  );

  const payloads = (trail.rows as { after: Record<string, unknown> }[]).map(
    (r) => r.after,
  );
  check(
    "no contact number went into the journal",
    payloads.every(
      (after) => !JSON.stringify(after).includes(phone.slice(4)),
    ),
  );
  check(
    "no reason went into the journal either",
    payloads.every((after) => !JSON.stringify(after).includes("circumstances")),
  );

  check(
    "the action has a colour of its own, and it is grey",
    AUDIT_TONES["pledge.change_requested"] === "grey" &&
      toneFor("pledge.change_requested") === "grey",
  );

  const lines: [string, Record<string, unknown>, string][] = [
    [
      "a reduction reads as the figure asked for",
      { kind: "reduce_amount", requestedAmountMinor: "50000000" },
      "reduce to KES 500,000",
    ],
    [
      "a plan change names the frequency",
      { kind: "change_plan", requestedFrequency: "semi_annually" },
      "change plan to semi annually",
    ],
    [
      "a name correction names the name",
      { kind: "correct_name", requestedName: "Jane Otieno" },
      "correct the name to Jane Otieno",
    ],
    [
      "a missing payment names the code",
      { kind: "payment_missing", paymentReference: "QGH7X8K9LM" },
      "payment QGH7X8K9LM not reflected",
    ],
    [
      "a cancellation says so",
      { kind: "cancel_pledge" },
      "cancel the pledge",
    ],
  ];

  for (const [label, after, expected] of lines) {
    const line = summarise("pledge.change_requested", null, after);
    check(label, line === expected, `"${line}"`);
  }

  check(
    "a detail line is never blank for this action",
    summarise("pledge.change_requested", null, {}) !== "",
  );

  /* -----------------------------------------------------------------------
   * 11. The rights matrix.
   * --------------------------------------------------------------------- */

  heading("11. who may do what");

  const viewer = { role: "viewer" as const, isSuper: false };
  const treasurer = { role: "treasurer" as const, isSuper: false };
  const admin = { role: "admin" as const, isSuper: false };

  check("a viewer may read the queue", can(viewer, "changeRequests.view"));
  check(
    "a viewer may not decide",
    !can(viewer, "changeRequests.decide"),
  );
  check("a treasurer may decide", can(treasurer, "changeRequests.decide"));
  check(
    "a treasurer may not approve a cancellation",
    !can(treasurer, "changeRequests.decideCancellation"),
  );
  check(
    "an administrator may",
    can(admin, "changeRequests.decideCancellation"),
  );

  /* -----------------------------------------------------------------------
   * 12. Deciding is still C2.
   * --------------------------------------------------------------------- */

  heading("12. approve and decline are not built yet");

  for (const [name, fn] of [
    ["approve", requests.approve],
    ["decline", requests.decline],
  ] as const) {
    try {
      await fn(db, { requestId: created.request.id, adminId: created.request.id });
      check(`${name} refuses to pretend`, false, "it returned");
    } catch (error) {
      check(
        `${name} refuses to pretend`,
        (error as Error).message === "not implemented in C1",
        (error as Error).message,
      );
    }
  }

  /* -----------------------------------------------------------------------
   * 13. Cleanup.
   * --------------------------------------------------------------------- */

  heading("13. cleanup");

  await cleanup();

  const left = await db.execute(sql`
    select count(*)::int as n
    from pledge_change_requests
    where source_ip in (${TEST_IP}::inet, ${OTHER_IP}::inet, ${IP_LIMIT_IP}::inet)
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
