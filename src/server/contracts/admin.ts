import { z } from "zod";

/**
 * The only admin write in v1. Kept as an action rather than a raw status field
 * so an invalid transition is impossible to express, not merely rejected.
 */
export const adminPledgeActionInput = z.object({
  action: z.literal("approve", "That is not an action this screen can take."),
});

export type AdminPledgeActionInput = z.infer<typeof adminPledgeActionInput>;

/**
 * The treasurer looking for a pledge to match a payment against.
 *
 * A single free text box, because whoever is holding the receipt does not know
 * whether what they have is a reference, a phone number or a name. The service
 * decides which of the three it looks like.
 */
export const pledgeSearchQuery = z.object({
  q: z
    .string()
    .trim()
    .min(2, "Type at least two characters to search.")
    .max(64, "That search term is too long."),
});

export type PledgeSearchQuery = z.infer<typeof pledgeSearchQuery>;

/**
 * The pledge list filters, as they arrive in the query string.
 *
 * Everything is optional and everything tolerates rubbish. These values come
 * from a URL somebody may have edited or bookmarked before a status was
 * renamed, and the right answer to an unreadable filter is the unfiltered
 * screen, not an error page.
 */
export const PLEDGE_STATUS_FILTERS = [
  "all",
  "pending",
  "verified",
  "fulfilled",
  "cancelled",
  "void",
] as const;

export type PledgeStatusFilter = (typeof PLEDGE_STATUS_FILTERS)[number];

export const pledgeListFilters = z.object({
  q: z
    .string()
    .trim()
    .max(64)
    .catch("")
    .transform((value) => (value === "" ? null : value)),
  status: z.enum(PLEDGE_STATUS_FILTERS).catch("all"),
  cursor: z.string().max(512).catch("").transform((value) => value || null),
});

export type PledgeListFilters = z.infer<typeof pledgeListFilters>;

/**
 * The audit log filters, as they arrive in the query string.
 *
 * Same tolerance as the pledge list: everything optional, everything catches.
 * These arrive from a URL somebody may have bookmarked, and the right answer
 * to an unreadable filter is the unfiltered screen rather than an error page.
 */
export const AUDIT_FILTERS = [
  "all",
  "pledges",
  "payments",
  "auth",
  "exports",
] as const;

export type AuditFilter = (typeof AUDIT_FILTERS)[number];

/**
 * Which action prefixes each filter covers.
 *
 * Held as data rather than as a switch in the query so that the screen, the
 * verification and any later endpoint all agree on what "auth" means. Empty
 * for "all", which the service reads as no restriction at all.
 */
export const AUDIT_FILTER_PREFIXES: Record<AuditFilter, readonly string[]> = {
  all: [],
  pledges: ["pledge."],
  payments: ["payment."],
  auth: ["admin.login", "admin.logout", "admin.totp"],
  exports: ["admin.export"],
};

export const auditListFilters = z.object({
  q: z
    .string()
    .trim()
    .max(64)
    .catch("")
    .transform((value) => (value === "" ? null : value)),
  filter: z.enum(AUDIT_FILTERS).catch("all"),
  cursor: z.string().max(512).catch("").transform((value) => value || null),
});

export type AuditListFilters = z.infer<typeof auditListFilters>;
