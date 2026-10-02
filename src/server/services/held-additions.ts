import { sql } from "drizzle-orm";

import type { Db } from "@/db";
import { auditLog } from "@/db/schema";
import { conflict, notFound } from "@/server/errors";
import type {
  ConfirmationMethod,
  DecideHeldAdditionInput,
} from "@/server/contracts/pledges";
import { edit, maskPhone } from "@/server/services/pledges";

/**
 * Additions waiting for the treasurer.
 *
 * An addition from a browser that did not make the pledge is recorded as a
 * held increment and moves nothing. The treasurer confirms it with the pledger
 * on the phone on record, or in person, and only then does the money join the
 * pledge. It arrives as a new admin increment written by the edit service,
 * exactly as a correction does, and the held row is marked confirmed and stays
 * uncounted. Corrections are new rows, not edits.
 */

export type HeldAddition = {
  incrementId: string;
  pledgeId: string;
  reference: string;
  pledgerName: string;
  /** The number on the pledger's record, masked unless the reader may see it. */
  phoneOnRecord: string;
  addedMinor: bigint;
  currentAmountMinor: bigint;
  pledgeStatus: string;
  createdAt: Date;
};

type Row = {
  increment_id: string;
  pledge_id: string;
  reference: string;
  full_name: string;
  phone_e164: string;
  added_minor: string;
  current_minor: string;
  pledge_status: string;
  created_at: string;
};

/** Every held addition, oldest first, so the longest waiting is rung first. */
export async function listHeld(
  db: Pick<Db, "execute">,
  args: { campaignSlug: string; revealPhone: boolean },
): Promise<HeldAddition[]> {
  const result = await db.execute(sql`
    select i.id::text as increment_id, p.id as pledge_id, p.reference,
           pr.full_name, pr.phone_e164,
           i.amount_minor::text as added_minor, p.amount_minor::text as current_minor,
           p.status::text as pledge_status, i.created_at
    from pledge_increments i
    join pledges p on p.id = i.pledge_id
    join pledgers pr on pr.id = p.pledger_id
    join campaigns c on c.id = p.campaign_id
    where i.status = 'held' and c.slug = ${args.campaignSlug} and p.deleted_at is null
    order by i.created_at, i.id
  `);

  return (result.rows as Row[]).map((row) => ({
    incrementId: row.increment_id,
    pledgeId: row.pledge_id,
    reference: row.reference,
    pledgerName: row.full_name,
    phoneOnRecord: args.revealPhone ? row.phone_e164 : maskPhone(row.phone_e164),
    addedMinor: BigInt(row.added_minor),
    currentAmountMinor: BigInt(row.current_minor),
    pledgeStatus: row.pledge_status,
    createdAt: new Date(row.created_at),
  }));
}

/** How many are waiting, for the badge on the nav. */
export async function countHeld(
  db: Pick<Db, "execute">,
  args: { campaignSlug: string },
): Promise<number> {
  const result = await db.execute(sql`
    select count(*)::int as waiting
    from pledge_increments i
    join pledges p on p.id = i.pledge_id
    join campaigns c on c.id = p.campaign_id
    where i.status = 'held' and c.slug = ${args.campaignSlug} and p.deleted_at is null
  `);
  return (result.rows[0] as { waiting: number }).waiting;
}

export type DecideHeldArgs = {
  incrementId: string;
  input: DecideHeldAdditionInput;
  adminId: string;
  request?: { ip?: string | null; userAgent?: string | null };
};

export type DecideHeldResult = {
  incrementId: string;
  pledgeId: string;
  reference: string;
  status: "confirmed" | "rejected";
  /** Whether a public figure may have moved, so the caller revalidates. */
  revalidatePublic: boolean;
};

/** Pledges that still take money. A finished pledge is not added to. */
const LIVE = new Set(["pending", "verified"]);

/**
 * Confirms or rejects one held addition, in one transaction.
 *
 * Confirming marks the held row confirmed and calls the edit service inside
 * the same transaction to raise the pledge by the held amount, so the new
 * admin increment, the edit's own audit row and this decision commit
 * together or not at all. Rejecting marks the row and touches nothing else.
 * Both write an audit row, and a confirmation records how the treasurer
 * confirmed it.
 */
export async function decide(db: Db, args: DecideHeldArgs): Promise<DecideHeldResult> {
  const { incrementId, input, adminId, request } = args;

  return db.transaction(async (tx) => {
    const found = await tx.execute(sql`
      select i.id::text as id, i.pledge_id, i.amount_minor::text as amount, i.status,
             p.reference, p.amount_minor::text as current, p.status::text as pledge_status,
             p.deleted_at
      from pledge_increments i
      join pledges p on p.id = i.pledge_id
      where i.id = ${incrementId}::bigint
      for update of i, p
    `);

    const row = found.rows[0] as
      | {
          id: string;
          pledge_id: string;
          amount: string;
          status: string;
          reference: string;
          current: string;
          pledge_status: string;
          deleted_at: string | null;
        }
      | undefined;

    if (!row || row.deleted_at) {
      throw notFound("held_addition_not_found", "That addition does not exist.");
    }

    if (row.status !== "held") {
      throw conflict(
        "held_addition_decided",
        "That addition has already been decided.",
      );
    }

    const added = BigInt(row.amount);
    const status = input.decision === "confirm" ? "confirmed" : "rejected";

    if (status === "confirmed") {
      if (!LIVE.has(row.pledge_status)) {
        throw conflict(
          "held_addition_pledge_closed",
          "That pledge is no longer open, so nothing can be added to it. Reject the addition instead.",
        );
      }

      const total = BigInt(row.current) + added;

      // The edit contract speaks whole shillings. Every public submission is
      // whole shillings, so this only refuses a pledge somebody corrected to
      // a fraction by hand.
      if (total % 100n !== 0n) {
        throw conflict(
          "held_addition_fractional",
          "That pledge is not a whole number of shillings, so the addition cannot be applied automatically.",
        );
      }

      await tx.execute(sql`
        update pledge_increments
        set status = 'confirmed', decided_by = ${adminId}::uuid, decided_at = now()
        where id = ${incrementId}::bigint
      `);

      await edit(tx, {
        pledgeId: row.pledge_id,
        input: {
          amountKes: Number(total / 100n),
          reason: `Confirmed held addition ${row.id}: ${methodWords(input.method!)}`,
        },
        adminId,
        request,
      });
    } else {
      await tx.execute(sql`
        update pledge_increments
        set status = 'rejected', decided_by = ${adminId}::uuid, decided_at = now()
        where id = ${incrementId}::bigint
      `);
    }

    await tx.insert(auditLog).values({
      actorType: "admin",
      actorId: adminId,
      action: `pledge.addition_${status}`,
      entity: "pledge",
      entityId: row.pledge_id,
      before: { status: "held" },
      after: {
        reference: row.reference,
        incrementId: row.id,
        addedMinor: added.toString(),
        status,
        method: input.method ?? null,
      },
      ip: request?.ip ?? null,
      userAgent: request?.userAgent ?? null,
    });

    return {
      incrementId: row.id,
      pledgeId: row.pledge_id,
      reference: row.reference,
      status,
      revalidatePublic: status === "confirmed",
    };
  });
}

function methodWords(method: ConfirmationMethod): string {
  return method === "in_person"
    ? "confirmed with the pledger in person"
    : "confirmed with the pledger on the phone on record";
}
