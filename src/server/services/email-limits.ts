import { createHmac } from "node:crypto";

import { sql } from "drizzle-orm";

import type { DbHandle, Tx } from "@/db";

/**
 * How many emails one address may be sent, per kind, in a day.
 *
 * The single mechanism for every email limit. A confirmation goes to whatever
 * address is typed on the public form, from the church's trusted sender, so
 * without a cap the form is a way to make the church email anybody as often
 * as a script can press it. The held addition notice goes to the address on
 * record and has had the same cap since it was written; it now counts here
 * too, with the same three a day it always had.
 *
 * Over a limit only the email is skipped. Whatever it was about, a pledge or
 * a held addition, is already recorded and stays recorded.
 *
 * Plain functions over a db handle, like every other service. The key for
 * the address hash arrives as data.
 */
export const EMAIL_LIMITS = {
  pledge_confirmation: { limit: 3, windowSeconds: 24 * 60 * 60 },
  addition_held: { limit: 3, windowSeconds: 24 * 60 * 60 },
} as const;

export type LimitedEmailKind = keyof typeof EMAIL_LIMITS;

/** The address as it is counted: trimmed and lower cased. */
export function normaliseRecipient(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * The keyed hash a recipient is counted under.
 *
 * Keyed, so the table cannot be turned back into addresses by hashing a list
 * of likely ones. Domain separated, so the same key used elsewhere never
 * produces the same value for the same input.
 */
export function recipientHash(address: string, key: string): string {
  return createHmac("sha256", key)
    .update(`email_sends:${normaliseRecipient(address)}`)
    .digest("hex");
}

/**
 * Takes one send from the address's allowance, or says there is none left.
 *
 * True means the send is counted and may go ahead. False means do not send:
 * the address has had its limit in the window, or there is no key to count it
 * under, in which case nothing is sent at all rather than sent uncounted.
 *
 * Counted when it is decided rather than when Resend answers, so a send that
 * fails still counts. Serialised per address and kind under a transaction
 * lock, so two submissions arriving together cannot both take the last one.
 * Pass the caller's transaction to make the reservation part of it: if that
 * transaction rolls back, so does the reservation.
 */
export async function reserveEmail(
  db: DbHandle,
  args: { to: string; kind: LimitedEmailKind; key: string | undefined },
): Promise<boolean> {
  const key = args.key?.trim();
  const to = normaliseRecipient(args.to);
  if (!key || to === "") return false;

  const hash = recipientHash(to, key);
  const { limit, windowSeconds } = EMAIL_LIMITS[args.kind];

  const run = async (tx: Tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`email_sends:${args.kind}:${hash}`}, 0))`,
    );
    const taken = await tx.execute(sql`
      insert into email_sends (recipient_hash, kind)
      select ${hash}, ${args.kind}
      where (
        select count(*) from email_sends
        where recipient_hash = ${hash}
          and kind = ${args.kind}
          and at > now() - make_interval(secs => ${windowSeconds})
      ) < ${limit}
      returning id
    `);
    return taken.rows.length === 1;
  };

  // On a plain handle this is the transaction the lock is held for. On a
  // caller's transaction it is a savepoint inside it, and the lock is held
  // until the caller commits.
  return db.transaction((tx) => run(tx));
}
