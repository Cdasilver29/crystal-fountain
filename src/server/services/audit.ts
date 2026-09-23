import { sql } from "drizzle-orm";

import type { Db } from "@/db";
import {
  AUDIT_FILTER_PREFIXES,
  type AuditFilter,
} from "@/server/contracts/admin";
import { type Page, decodeCursor, pageSize, toPage } from "@/server/pagination";

/**
 * Reading the audit log.
 *
 * audit_log is append only and nothing in this file writes to it. Rows are put
 * there by the services that perform the action, which is the only way the
 * journal can be trusted: a screen that could edit it would not be an audit
 * log.
 *
 * Only an administrator reads this. It is the one admin screen where the
 * treasurer is shut out as well as the viewer, because it records who did what
 * and a journal that the people it describes can curate is worth nothing.
 *
 * The before and after columns are jsonb written by whichever service recorded
 * the row, so their shape varies by action. Nothing here dumps them raw. Each
 * action gets a named summary built from the fields it is known to carry,
 * which is both readable and the reason a payer's phone number cannot leak
 * onto the screen just because it happens to sit in the payload.
 */

export type AuditRow = {
  id: string;
  at: Date;
  actorType: string;
  actorId: string | null;
  /** The admin's name, already resolved, or null for public and system rows. */
  actorName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  /** One line, built from before and after. Empty when there is nothing to say. */
  detail: string;
};

type RawAuditRow = {
  id: string;
  at: string;
  actor_type: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

/* ---------------------------------------------------------------------------
 * The detail line.
 * ------------------------------------------------------------------------- */

/** Minor units to a display string, without going through a number. */
function kes(minor: unknown): string | null {
  if (typeof minor !== "string" && typeof minor !== "number") return null;
  try {
    const whole = BigInt(minor) / 100n;
    return `KES ${whole.toLocaleString("en-KE")}`;
  } catch {
    return null;
  }
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Why a request was closed, in words rather than in a code. */
const CLOSURES: Record<string, string> = {
  pledge_voided: "the pledge was voided",
  pledge_cancelled: "the pledge was cancelled",
  pledge_deleted: "the pledge was removed",
};

/**
 * What a change request asked for, in one phrase.
 *
 * Shared by all four of its actions, so the thing being asked for is described
 * the same way whether it is being requested, approved, declined or closed,
 * and the four cannot drift into four vocabularies for one event.
 *
 * Read from named fields per kind rather than dumped, which is what keeps the
 * pledger's own reason and their contact number off a screen that is read
 * whole. The amount is looked for under both names it travels under: the
 * request carries what was asked for, and the approval carries what the pledge
 * ended up at, which for a reduction are the same number arriving by different
 * routes.
 */
function changePhrase(a: Record<string, unknown>): string {
  switch (str(a.kind)) {
    case "reduce_amount": {
      const amount = kes(a.requestedAmountMinor) ?? kes(a.amountMinor);
      return amount ? `reduce to ${amount}` : "reduce the amount";
    }

    case "change_plan": {
      const frequency =
        str(a.requestedFrequency) ?? str(a.installmentFrequency);
      return frequency
        ? `change plan to ${frequency.replace(/_/g, " ")}`
        : "change the plan";
    }

    case "correct_name": {
      const name = str(a.requestedName) ?? str(a.fullName);
      return name ? `correct the name to ${name}` : "correct the name";
    }

    case "payment_missing": {
      const ref = str(a.paymentReference);
      const amount = kes(a.paymentAmountMinor);
      if (ref && amount) return `${amount} paid as ${ref} not reflected`;
      if (ref) return `payment ${ref} not reflected`;
      return "a payment is not reflected";
    }

    case "cancel_pledge":
      return "cancel the pledge";

    default:
      // A kind nobody has taught this about still says that something was
      // asked, which is true and useful, rather than rendering blank.
      return "a change";
  }
}

/**
 * A one line summary of what changed.
 *
 * Pure, so the verification can check every action's wording without a
 * database. Reads named fields only: an action nobody has taught it about
 * falls through to a status change if there is one, and to nothing if there is
 * not, rather than printing a wall of JSON.
 */
export function summarise(
  action: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string {
  const b = before ?? {};
  const a = after ?? {};

  switch (action) {
    case "pledge.created": {
      const ref = str(a.reference);
      const amount = kes(a.amountMinor);
      const channel = str(a.channel);
      return [ref, amount, channel && `via ${channel}`]
        .filter(Boolean)
        .join(", ");
    }

    case "pledge.change_requested":
      return changePhrase(a);

    case "pledge.change_approved":
      return `${changePhrase(a)} approved`;

    case "pledge.change_declined":
      return `${changePhrase(a)} declined`;

    case "pledge.change_closed":
      return `${changePhrase(a)} closed, ${CLOSURES[str(a.because) ?? ""] ?? "the pledge went away"}`;

    case "pledgers.display_consent_withdrawn": {
      // The reference and nothing else. The name is deliberately not in the
      // payload, so there is nothing here to print even if somebody wanted to.
      const ref = str(a.reference);
      return ref
        ? `${ref}, name removed from the public list`
        : "name removed from the public list";
    }

    case "pledgers.organisation_flagged": {
      // Which way it was set is the whole content of the row, because the two
      // directions publish different amounts of somebody's name.
      const ref = str(a.reference);
      const marked = a.isOrganisation === true;
      const what = marked ? "marked an organisation" : "marked a person";
      return ref ? `${ref}, ${what}` : what;
    }

    case "pledgers.display_name_set": {
      // The rendered names rather than the column, so a reset reads as what
      // it went back to instead of as "null".
      const ref = str(a.reference);
      const was = str(b.shownAs);
      const now = str(a.shownAs);
      const what =
        a.publicDisplayName === null
          ? `public name reset to automatic${now ? `, "${now}"` : ""}`
          : `public name set to "${now ?? ""}"`;
      const full = was && was !== now ? `${what}, was "${was}"` : what;
      return ref ? `${ref}, ${full}` : full;
    }

    case "payment.recorded": {
      const amount = kes(a.amountMinor);
      const method = str(a.method);
      const ref = str(a.externalRef);
      // The payer's name and phone are in this payload and stay out of it.
      return [amount, method, ref && `ref ${ref}`].filter(Boolean).join(", ");
    }

    case "payment.allocated": {
      const amount = kes(a.amountMinor);
      const ref = str(a.pledgeReference);
      if (amount && ref) return `${amount} allocated to ${ref}`;
      return amount ?? "";
    }

    case "payment.deallocated": {
      // The allocation being reversed is in before; after carries only the
      // timestamp of the reversal.
      const amount = kes(b.amountMinor);
      const ref = str(b.pledgeReference);
      if (amount && ref) return `${amount} released from ${ref}`;
      return amount ? `${amount} released` : "";
    }

    case "admin.export": {
      // The entity says which book was taken; the row count says how much.
      const rows = a.rowCount;
      return typeof rows === "number" ? `CSV, ${rows} rows` : "CSV";
    }

    case "admin.forbidden": {
      const role = str(a.role);
      const attempted = str(a.attempted);
      if (role && attempted) return `${role} attempted ${attempted}`;
      return attempted ?? "";
    }

    case "admin.login": {
      /*
       * How they got in matters more than that they did. A password sign in
       * has been through TOTP; a Google one has been through Google's own
       * protection instead, and the trail is where that difference is visible
       * afterwards.
       *
       * A session opened before the method was recorded says nothing rather
       * than guessing at one.
       */
      const email = str(a.email);
      const method = str(a.method);
      const how =
        method === "google"
          ? "signed in with Google"
          : method === "password"
            ? "signed in with password"
            : null;
      return [email && `email: ${email}`, how].filter(Boolean).join(", ");
    }

    case "admin.google_rejected": {
      // The reason is the whole point of the row: it separates somebody who
      // was never an administrator from one who has been retired.
      const email = str(a.email);
      const reason = str(a.reason);
      const why =
        reason === "deactivated"
          ? "account deactivated"
          : reason === "not_an_admin"
            ? "not an administrator"
            : reason;
      return [email && `email: ${email}`, why].filter(Boolean).join(", ");
    }

    case "admin.login_failed":
    case "admin.logout":
    case "admin.totp_enrolled": {
      const email = str(a.email);
      return email ? `email: ${email}` : "";
    }

    case "admin.totp_enrolment_reset": {
      // The reason is the whole point of the row: the flag was cleared because
      // the enrolment it pointed at was not there.
      const email = str(a.email);
      const reason = str(a.reason);
      return [email && `email: ${email}`, reason].filter(Boolean).join(", ");
    }

    case "admin.login_locked": {
      const email = str(a.email);
      const retry = a.retryAfterSeconds;
      const minutes =
        typeof retry === "number" ? `, locked ${Math.ceil(retry / 60)} min` : "";
      return email ? `email: ${email}${minutes}` : "";
    }

    case "admin.created": {
      const email = str(a.email);
      const role = str(a.role);
      return [email && `email: ${email}`, role].filter(Boolean).join(", ");
    }

    default:
      break;
  }

  // Anything else with a status on both sides reads as the transition, which
  // covers pledge.approved, pledge.fulfilled, pledge.unfulfilled and
  // pledge.voided without naming them one at a time.
  const from = str(b.status);
  const to = str(a.status);
  if (from && to) return `${from} → ${to}`;
  if (to) return to;

  return "";
}

/* ---------------------------------------------------------------------------
 * The query.
 * ------------------------------------------------------------------------- */

/**
 * One page of the journal, newest first.
 *
 * The actor's name is joined here rather than looked up per row, so a page of
 * fifty is one query. A deactivated or deleted administrator still has their
 * name on their rows, because the join is on the id the row recorded and not
 * on anything that has to still be true.
 *
 * The filter is a set of action prefixes rather than an exact list, so an
 * action added to a service later appears under the right heading without this
 * file being edited.
 */
export async function listForAdmin(
  db: Db,
  args: {
    q?: string | null;
    filter?: AuditFilter;
    limit?: number;
    cursor?: string | null;
  },
): Promise<Page<AuditRow>> {
  const limit = pageSize(args.limit);
  const cursor = decodeCursor(args.cursor);
  const prefixes = AUDIT_FILTER_PREFIXES[args.filter ?? "all"] ?? [];

  /*
   * Search matches the action or the actor's name. The term is escaped for
   * like, so somebody searching for "100%" gets the rows containing "100%"
   * rather than every row in the journal.
   */
  const term = args.q?.trim()
    ? `%${args.q.trim().replace(/[%_\\]/g, "\\$&")}%`
    : null;

  /*
   * Each clause is built or omitted rather than switched off by a boolean
   * parameter inside the SQL.
   *
   * The first version passed the prefix list as an array parameter and guarded
   * it with a boolean. On the unfiltered screen that array is empty, which
   * renders as "like any (::text[])" and is a syntax error, so the one filter
   * anybody sees first was the one that could not run. Building the clause in
   * TypeScript means an absent filter contributes no SQL at all.
   */
  const actionClause =
    prefixes.length === 0
      ? sql`true`
      : sql`(${sql.join(
          prefixes.map((p) => sql`l.action like ${`${p}%`}`),
          sql` or `,
        )})`;

  const searchClause =
    term === null
      ? sql`true`
      : sql`(l.action ilike ${term} escape '\\'
             or u.full_name ilike ${term} escape '\\')`;

  /*
   * (at, id) < (k, i) compares the pair lexicographically in one indexable
   * expression, which is both shorter and more correct than spelling out the
   * "or equal and id less than" form by hand.
   */
  const cursorClause =
    cursor === null
      ? sql`true`
      : sql`(l.at, l.id) < (${cursor.key}::timestamptz, ${cursor.id}::bigint)`;

  const result = await db.execute(sql`
    select l.id::text as id,
           l.at,
           l.actor_type,
           l.actor_id::text as actor_id,
           u.full_name as actor_name,
           l.action,
           l.entity,
           l.entity_id::text as entity_id,
           l.before,
           l.after
    from audit_log l
    left join admin_users u on u.id = l.actor_id
    where ${actionClause}
      and ${searchClause}
      and ${cursorClause}
    order by l.at desc, l.id desc
    limit ${limit + 1}
  `);

  const rows = (result.rows as RawAuditRow[]).map((row) => ({
    id: row.id,
    at: new Date(row.at),
    actorType: row.actor_type,
    actorId: row.actor_id,
    actorName: row.actor_name,
    action: row.action,
    entity: row.entity,
    entityId: row.entity_id,
    detail: summarise(row.action, row.before, row.after),
  }));

  return toPage(rows, limit, (row) => ({
    key: row.at.toISOString(),
    id: row.id,
  }));
}
