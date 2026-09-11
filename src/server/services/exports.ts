import { sql } from "drizzle-orm";

import type { Db } from "@/db";
import { auditLog } from "@/db/schema";
import { csvFile, csvText, exportDateStamp } from "@/server/csv";
import { notFound } from "@/server/errors";
import { minorToKes } from "@/server/money";

/**
 * CSV exports for the treasurer.
 *
 * These are the one place the platform hands out a file of contact details, so
 * two rules from CLAUDE.md meet here.
 *
 * The first is that no identity document ever leaves the system. The schema has
 * encrypted columns for a national ID and they are not collected in v1, but the
 * rule is stronger than that: the select lists below name their columns
 * explicitly, so a future migration that starts populating id_ciphertext cannot
 * quietly add it to a file the treasurer emails around. Adding it would take a
 * deliberate edit here.
 *
 * The second is that this is a privileged read and it is recorded. Every export
 * appends an admin.export row naming who took the file and how many rows went
 * with it, in the same transaction as nothing else, because the read is not a
 * write and there is nothing to roll back. If the audit row fails, the export
 * fails: a copy of the congregation's phone numbers should not leave without a
 * record that it did.
 *
 * Not filtered. What is on the treasurer's screen is a page; what comes out of
 * here is the book. Ordered oldest first, because these files are read down the
 * page while reconciling against a bank statement.
 */

export type ExportKind = "pledges" | "payments";

export type ExportResult = {
  csv: string;
  filename: string;
  rowCount: number;
};

export type ExportArgs = {
  campaignSlug: string;
  /** The admin_users row of whoever is downloading. */
  adminId: string;
  request?: { ip: string | null; userAgent: string | null };
};

/** The audit row. Written after the rows are read and before they are returned. */
async function recordExport(
  db: Db,
  args: ExportArgs & { entity: ExportKind; rowCount: number; columns: readonly string[] },
): Promise<void> {
  await db.insert(auditLog).values({
    actorType: "admin",
    actorId: args.adminId,
    action: "admin.export",
    entity: args.entity,
    // The export is not one row, so there is no entity_id to name.
    entityId: null,
    after: {
      rowCount: args.rowCount,
      // What actually left the building. A later question about whether an old
      // export carried a particular field is answerable from this row alone.
      columns: [...args.columns],
      campaignSlug: args.campaignSlug,
    },
    ip: args.request?.ip ?? null,
    userAgent: args.request?.userAgent ?? null,
  });
}

const PLEDGE_COLUMNS = [
  "reference",
  "full_name",
  "phone",
  "email",
  "amount_kes",
  "status",
  "created_at",
  "verified_at",
] as const;

type PledgeExportRow = {
  reference: string;
  full_name: string;
  phone_e164: string;
  email: string | null;
  amount_minor: string;
  status: string;
  created_at: string;
  verified_at: string | null;
};

export async function pledges(
  db: Db,
  args: ExportArgs,
): Promise<ExportResult> {
  const result = await db.execute(sql`
    select p.reference,
           g.full_name,
           g.phone_e164,
           g.email,
           p.amount_minor,
           p.status,
           p.created_at,
           p.verified_at
    from pledges p
    join pledgers g on g.id = p.pledger_id
    join campaigns c on c.id = p.campaign_id
    where c.slug = ${args.campaignSlug}
      and p.deleted_at is null
    order by p.created_at, p.id
  `);

  const rows = (result.rows as PledgeExportRow[]).map((row) => [
    row.reference,
    row.full_name,
    // The whole number, unmasked. This is a treasurer export, not a public
    // surface, and ringing a pledger is the point of it. Marked as text so a
    // spreadsheet keeps the leading plus instead of reading it as a number.
    csvText(row.phone_e164),
    row.email,
    // Whole shillings, from the minor units, as an integer. Never a float.
    minorToKes(BigInt(row.amount_minor)),
    row.status,
    new Date(row.created_at).toISOString(),
    row.verified_at ? new Date(row.verified_at).toISOString() : null,
  ]);

  await recordExport(db, {
    ...args,
    entity: "pledges",
    rowCount: rows.length,
    columns: PLEDGE_COLUMNS,
  });

  return {
    csv: csvFile(PLEDGE_COLUMNS, rows),
    filename: `pledges-${exportDateStamp()}.csv`,
    rowCount: rows.length,
  };
}

const PAYMENT_COLUMNS = [
  "paid_at",
  "method",
  "external_ref",
  "amount_kes",
  "payer_name",
  "payer_phone",
  "account_ref",
  "status",
  "allocation_status",
] as const;

type PaymentExportRow = {
  paid_at: string;
  method: string;
  external_ref: string | null;
  amount_minor: string;
  payer_name_raw: string | null;
  payer_msisdn: string | null;
  account_ref_raw: string | null;
  status: string;
  allocation_status: string;
};

export async function payments(
  db: Db,
  args: ExportArgs,
): Promise<ExportResult> {
  /*
   * The allocation status is derived here exactly as the payment list derives
   * it, reversed allocations excluded, so a treasurer reconciling from this
   * file and a treasurer reading the screen cannot reach different answers
   * about the same payment.
   */
  const result = await db.execute(sql`
    select p.paid_at,
           p.method,
           p.external_ref,
           p.amount_minor,
           p.payer_name_raw,
           p.payer_msisdn,
           p.account_ref_raw,
           p.status,
           case
             when coalesce(a.allocated_minor, 0) = 0 then 'unallocated'
             when coalesce(a.allocated_minor, 0) >= p.amount_minor
               then 'fully_allocated'
             else 'partial'
           end as allocation_status
    from payments p
    join campaigns c on c.id = p.campaign_id
    left join lateral (
      select sum(amount_minor) as allocated_minor
      from payment_allocations
      where payment_id = p.id
        and reversed_at is null
    ) a on true
    where c.slug = ${args.campaignSlug}
    order by p.paid_at, p.id
  `);

  const rows = (result.rows as PaymentExportRow[]).map((row) => [
    new Date(row.paid_at).toISOString(),
    row.method,
    row.external_ref,
    minorToKes(BigInt(row.amount_minor)),
    row.payer_name_raw,
    csvText(row.payer_msisdn),
    row.account_ref_raw,
    row.status,
    row.allocation_status,
  ]);

  await recordExport(db, {
    ...args,
    entity: "payments",
    rowCount: rows.length,
    columns: PAYMENT_COLUMNS,
  });

  return {
    csv: csvFile(PAYMENT_COLUMNS, rows),
    filename: `payments-${exportDateStamp()}.csv`,
    rowCount: rows.length,
  };
}

/** Guards against a slug that names no campaign, so an empty file is never a silent lie. */
export async function assertCampaign(
  db: Db,
  campaignSlug: string,
): Promise<void> {
  const result = await db.execute(sql`
    select 1 from campaigns where slug = ${campaignSlug} limit 1
  `);
  if (result.rows.length === 0) {
    throw notFound("campaign_not_found", `No campaign with slug ${campaignSlug}.`);
  }
}
