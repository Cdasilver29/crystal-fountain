import { eq, sql } from "drizzle-orm";

import type { Db } from "@/db";
import { auditLog, campaigns } from "@/db/schema";
import { notFound } from "@/server/errors";
import { kesToMinor, percentOf } from "@/server/money";
import {
  PAYMENT_DETAIL_FIELDS,
  type CampaignSettingsInput,
} from "@/server/contracts/campaign";

/**
 * Campaign services.
 *
 * Totals are read from v_campaign_totals, which is the only place they come
 * from. Never a counter column, never a constant, never config.
 */

export type CampaignTotals = {
  currency: string;
  targetMinor: bigint;
  pledgedMinor: bigint;
  receivedMinor: bigint;
  /** Target less pledged, floored at zero once the campaign is oversubscribed. */
  remainingMinor: bigint;
  percentPledged: number;
  percentReceived: number;
  /**
   * Received as a share of pledged, not of the target.
   *
   * How much of what was promised has actually arrived, which is a different
   * question from how far the campaign has got and the one the congregation
   * asks second. Zero while nothing has been pledged, because a share of
   * nothing is not a hundred percent.
   */
  percentRedeemed: number;
  pledgeCount: number;
  pledgerCount: number;
};

type TotalsRow = {
  currency: string;
  target_minor: string;
  pledged_minor: string;
  received_minor: string;
  pledge_count: string;
  pledger_count: string;
};

/**
 * Live campaign totals.
 *
 * The driver hands bigint columns back as strings, which is what we want:
 * they become BigInt here without ever passing through a JavaScript number.
 * All the arithmetic is integer arithmetic on minor units, and the only
 * rounding happens once, when the two percentages are produced.
 */
export async function getTotals(
  db: Db,
  args: { campaignSlug: string },
): Promise<CampaignTotals> {
  const result = await db.execute(sql`
    select c.currency,
           t.target_minor,
           t.pledged_minor,
           t.received_minor,
           t.pledge_count,
           t.pledger_count
    from v_campaign_totals t
    join campaigns c on c.id = t.campaign_id
    where c.slug = ${args.campaignSlug}
    limit 1
  `);

  const row = result.rows[0] as TotalsRow | undefined;

  if (!row) {
    throw notFound(
      "campaign_not_found",
      `No campaign with slug ${args.campaignSlug}.`,
    );
  }

  const targetMinor = BigInt(row.target_minor);
  const pledgedMinor = BigInt(row.pledged_minor);
  const receivedMinor = BigInt(row.received_minor);

  return {
    currency: row.currency,
    targetMinor,
    pledgedMinor,
    receivedMinor,
    remainingMinor:
      targetMinor > pledgedMinor ? targetMinor - pledgedMinor : 0n,
    percentPledged: percentOf(pledgedMinor, targetMinor),
    percentReceived: percentOf(receivedMinor, targetMinor),
    percentRedeemed: percentOf(receivedMinor, pledgedMinor),
    // Counts, not money, so a number is the right type here.
    pledgeCount: Number(row.pledge_count),
    pledgerCount: Number(row.pledger_count),
  };
}

/* ---------------------------------------------------------------------------
 * How many pledges sit at each commitment level.
 * ------------------------------------------------------------------------- */

/**
 * The smallest count a band may show publicly.
 *
 * Below this a count can be matched against the public pledger list, which
 * carries names and amounts: "one family at KES 10 million" beside a list with
 * one consented name at that figure says who the unconsented other is, or that
 * there is none. Three is where that stops being a lookup.
 */
export const BAND_COUNT_PUBLIC_MINIMUM = 3;

export type CommitmentBand = {
  floorMinor: bigint;
  /** Pledges in the band, or null where there are too few to show. */
  pledges: number | null;
};

/**
 * Counts pledges into bands by amount.
 *
 * Each floor opens a band that runs up to, but not including, the next floor
 * above it; the highest floor's band has no ceiling, and anything under the
 * lowest floor is in no band. The floors arrive as an argument rather than
 * being read from the content file, so this stays a plain function over the
 * database.
 *
 * Counts only what the tracker counts: verified and fulfilled, not deleted,
 * the same statuses v_campaign_totals sums. A fulfilled pledge is a verified
 * one that has been paid in full, and leaving it out would make a band shrink
 * each time a family finished giving.
 *
 * The public minimum is applied here, so a small count never leaves the
 * service and cannot reach a cache, a payload or a page by accident.
 */
export async function commitmentBands(
  db: Db,
  args: { campaignSlug: string; floorsMinor: readonly bigint[] },
): Promise<CommitmentBand[]> {
  if (args.floorsMinor.length === 0) return [];

  const floors = sql.join(
    args.floorsMinor.map((floor) => sql`${floor.toString()}::bigint`),
    sql`, `,
  );

  const result = await db.execute(sql`
    with bands as (
      select floor_minor,
             lead(floor_minor) over (order by floor_minor) as ceiling_minor
      from unnest(array[${floors}]) as floor_minor
    ),
    counted as (
      select p.amount_minor
      from pledges p
      join campaigns c on c.id = p.campaign_id
      where c.slug = ${args.campaignSlug}
        and p.deleted_at is null
        and p.status in ('verified', 'fulfilled')
    )
    select b.floor_minor::text as floor_minor,
           count(counted.amount_minor)::int as pledges
    from bands b
    left join counted
      on counted.amount_minor >= b.floor_minor
     and (b.ceiling_minor is null or counted.amount_minor < b.ceiling_minor)
    group by b.floor_minor
  `);

  const byFloor = new Map(
    (result.rows as { floor_minor: string; pledges: number }[]).map((row) => [
      row.floor_minor,
      Number(row.pledges),
    ]),
  );

  // Returned in the order the floors were given, whatever order Postgres
  // grouped them in.
  return args.floorsMinor.map((floorMinor) => {
    const pledges = byFloor.get(floorMinor.toString()) ?? 0;
    return {
      floorMinor,
      pledges: pledges >= BAND_COUNT_PUBLIC_MINIMUM ? pledges : null,
    };
  });
}

/* ---------------------------------------------------------------------------
 * Settings the super administrator can change.
 * ------------------------------------------------------------------------- */

/** Where money is sent, as the campaign row holds it. Nulls fall back. */
export type PaymentDetails = {
  mpesaPaybill: string | null;
  mpesaAccountName: string | null;
  bankName: string | null;
  bankBranch: string | null;
  bankAccountName: string | null;
  bankAccount: string | null;
  bankSwift: string | null;
  bankBranchCode: string | null;
};

export type CampaignSettings = PaymentDetails & {
  id: string;
  slug: string;
  name: string;
  targetMinor: bigint;
  openingBalanceMinor: bigint;
  /** Null means the environment default applies. */
  autoApproveLimitMinor: bigint | null;
  isPublic: boolean;
  currency: string;
};

/** Everything the settings screen shows, and the public pages read. */
export async function getSettings(
  db: Db,
  args: { campaignSlug: string },
): Promise<CampaignSettings> {
  const [row] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.slug, args.campaignSlug))
    .limit(1);

  if (!row) {
    throw notFound(
      "campaign_not_found",
      `No campaign with slug ${args.campaignSlug}.`,
    );
  }

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    targetMinor: row.targetMinor,
    openingBalanceMinor: row.openingBalanceMinor,
    autoApproveLimitMinor: row.autoApproveLimitMinor,
    isPublic: row.isPublic,
    currency: row.currency,
    mpesaPaybill: row.mpesaPaybill,
    mpesaAccountName: row.mpesaAccountName,
    bankName: row.bankName,
    bankBranch: row.bankBranch,
    bankAccountName: row.bankAccountName,
    bankAccount: row.bankAccount,
    bankSwift: row.bankSwift,
    bankBranchCode: row.bankBranchCode,
  };
}

export type UpdateSettingsArgs = {
  campaignSlug: string;
  input: CampaignSettingsInput;
  adminId: string;
  request?: { ip?: string | null; userAgent?: string | null };
};

export type UpdateSettingsResult = {
  changed: string[];
  /** Whether a public figure moved, so the caller knows to revalidate. */
  affectsTotals: boolean;
};

/**
 * Changes the campaign settings, recording exactly what moved.
 *
 * The before and after of every changed field go into one audit row. These are
 * the values the whole public site is measured against and the account numbers
 * the congregation's money is sent to, and a journal entry saying only that
 * "settings were updated" would be a record of nothing.
 *
 * A field that did not move is left out of both columns, so reading the row
 * later shows the change rather than a restatement of everything.
 */
export async function updateSettings(
  db: Db,
  args: UpdateSettingsArgs,
): Promise<UpdateSettingsResult> {
  const { campaignSlug, input, adminId, request } = args;

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(campaigns)
      .where(eq(campaigns.slug, campaignSlug))
      .for("update")
      .limit(1);

    if (!before) {
      throw notFound(
        "campaign_not_found",
        `No campaign with slug ${campaignSlug}.`,
      );
    }

    const changed: string[] = [];
    const beforeJson: Record<string, unknown> = {};
    const afterJson: Record<string, unknown> = {};
    const set: Record<string, unknown> = {};

    /** Records a change, or does nothing when the value is the same. */
    const move = (
      field: string,
      was: unknown,
      now: unknown,
      column = field,
    ) => {
      const same =
        typeof was === "bigint" || typeof now === "bigint"
          ? String(was) === String(now)
          : was === now;
      if (same) return;
      changed.push(field);
      beforeJson[field] = typeof was === "bigint" ? was.toString() : was;
      afterJson[field] = typeof now === "bigint" ? now.toString() : now;
      set[column] = now;
    };

    if (input.targetKes !== undefined) {
      move("targetMinor", before.targetMinor, kesToMinor(input.targetKes));
    }

    if (input.openingBalanceKes !== undefined) {
      move(
        "openingBalanceMinor",
        before.openingBalanceMinor,
        kesToMinor(input.openingBalanceKes),
      );
    }

    if (input.autoApproveLimitKes !== undefined) {
      move(
        "autoApproveLimitMinor",
        before.autoApproveLimitMinor,
        input.autoApproveLimitKes === null
          ? null
          : kesToMinor(input.autoApproveLimitKes),
      );
    }

    if (input.isPublic !== undefined) {
      move("isPublic", before.isPublic, input.isPublic);
    }

    for (const field of PAYMENT_DETAIL_FIELDS) {
      if (input[field] === undefined) continue;
      move(field, before[field], input[field] ?? null);
    }

    if (changed.length === 0) {
      return { changed, affectsTotals: false };
    }

    await tx
      .update(campaigns)
      .set(set)
      .where(eq(campaigns.id, before.id));

    await tx.insert(auditLog).values({
      actorType: "admin",
      actorId: adminId,
      action: "campaign.updated",
      entity: "campaign",
      entityId: before.id,
      before: beforeJson,
      after: { ...afterJson, changed, slug: before.slug },
      ip: request?.ip ?? null,
      userAgent: request?.userAgent ?? null,
    });

    /*
     * The target and the opening balance are both inside v_campaign_totals, so
     * either one moves the figure on every public page. The paybill does not:
     * it changes what the instructions say, not what the tracker reads.
     */
    return {
      changed,
      affectsTotals:
        changed.includes("targetMinor") ||
        changed.includes("openingBalanceMinor"),
    };
  });
}
