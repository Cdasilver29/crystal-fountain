import { sql } from "drizzle-orm";

import type { Db } from "@/db";
import { auditLog } from "@/db/schema";

/**
 * Deleting what is no longer needed.
 *
 * The rate limit tables record an IP address, or an email address, on every
 * request they count, and an IP address is personal data. None of them looks
 * back further than a day: the longest window any limit counts over is the 24
 * hours of the per recipient email limit, and most are an hour or fifteen
 * minutes. So everything older than 48 hours does nothing except sit there,
 * and it goes.
 *
 * Expired payment detail changes go after 30 days. Nobody approved them, so
 * they never changed anything, and the audit log keeps the request and the
 * expiry; the row itself holds two full sets of bank details for no reason.
 *
 * Never touched: the audit log, held additions and every other increment,
 * change requests, payments, pledges, and payment changes that were approved
 * or rejected, which are part of the record of who changed what.
 *
 * Run by the daily job. A plain function over a db handle, so it can be run
 * and checked from a script.
 */

/** How long a rate limit row is kept. Twice the longest window counted. */
export const RATE_LIMIT_RETENTION_HOURS = 48;

/** How long an expired payment detail change is kept. */
export const EXPIRED_PAYMENT_CHANGE_RETENTION_DAYS = 30;

export type PruneResult = {
  pledgeLookups: number;
  pledgeSubmissions: number;
  publicListRequests: number;
  adminLoginAttempts: number;
  authRateLimits: number;
  emailSends: number;
  expiredPaymentChanges: number;
};

export function prunedTotal(result: PruneResult): number {
  return Object.values(result).reduce((sum, n) => sum + n, 0);
}

export async function prune(db: Db): Promise<PruneResult> {
  return db.transaction(async (tx) => {
    const cutoff = sql`now() - make_interval(hours => ${RATE_LIMIT_RETENTION_HOURS})`;

    const count = async (statement: ReturnType<typeof sql>) =>
      (await tx.execute(statement)).rows.length;

    const result: PruneResult = {
      pledgeLookups: await count(
        sql`delete from pledge_lookups where at < ${cutoff} returning 1`,
      ),
      pledgeSubmissions: await count(
        sql`delete from pledge_submissions where at < ${cutoff} returning 1`,
      ),
      publicListRequests: await count(
        sql`delete from public_list_requests where at < ${cutoff} returning 1`,
      ),
      adminLoginAttempts: await count(
        sql`delete from admin_login_attempts where at < ${cutoff} returning 1`,
      ),
      // Better Auth keeps the time of the last request as epoch milliseconds.
      authRateLimits: await count(sql`
        delete from auth_rate_limits
        where last_request < (extract(epoch from ${cutoff}) * 1000)::bigint
        returning 1
      `),
      emailSends: await count(
        sql`delete from email_sends where at < ${cutoff} returning 1`,
      ),
      expiredPaymentChanges: await count(sql`
        delete from payment_detail_changes
        where status = 'expired'
          and expires_at < now() - make_interval(days => ${EXPIRED_PAYMENT_CHANGE_RETENTION_DAYS})
        returning 1
      `),
    };

    /*
     * One row a day when anything went, so the journal shows that personal
     * data is being cleared and how much, without saying whose.
     */
    if (prunedTotal(result) > 0) {
      await tx.insert(auditLog).values({
        actorType: "system",
        action: "system.retention_pruned",
        entity: "retention",
        after: {
          ...result,
          rateLimitHours: RATE_LIMIT_RETENTION_HOURS,
          expiredPaymentChangeDays: EXPIRED_PAYMENT_CHANGE_RETENTION_DAYS,
        },
      });
    }

    return result;
  });
}
