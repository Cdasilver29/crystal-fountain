import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  char,
  check,
  customType,
  date,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Drizzle schema for the Crystal Fountain pledge platform.
 *
 * Mirrors the DDL in PLAN.md section 4 one to one. No columns added, none renamed.
 * The only deviation is declaration order: admin_users is declared before payments,
 * because payments.recorded_by references it and the order in PLAN.md would not run.
 *
 * Money is bigint in minor units (cents) throughout, read in JS as a bigint and never
 * as a number. KES 550,000,000 is 55000000000 minor units.
 */

// citext and bytea have no built in helper in drizzle pg-core.
const citext = customType<{ data: string; driverData: string }>({
  dataType: () => "citext",
});

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const minor = (name: string) => bigint(name, { mode: "bigint" });

// campaign

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    targetMinor: minor("target_minor").notNull(),
    currency: char("currency", { length: 3 }).notNull().default("KES"),
    // Funds raised before this platform existed.
    openingBalanceMinor: minor("opening_balance_minor")
      .notNull()
      .default(sql`0`),
    startsOn: date("starts_on").notNull(),
    targetDate: date("target_date"),
    isPublic: boolean("is_public").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [check("campaigns_target_minor_check", sql`${t.targetMinor} > 0`)],
);

// the person

export const pledgers = pgTable(
  "pledgers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // +2547XXXXXXXX, the primary identity key.
    phoneE164: text("phone_e164").notNull().unique(),
    phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
    fullName: text("full_name").notNull(),
    email: citext("email"),
    // Church membership number, preferred over national ID.
    membershipNo: text("membership_no"),
    isMember: boolean("is_member"),
    idType: text("id_type"),
    // Encrypted and nullable. Not collected in v1, see CLAUDE.md.
    idCiphertext: bytea("id_ciphertext"),
    // HMAC-SHA256 with a server pepper, for dedupe only.
    idHash: bytea("id_hash"),
    // What appears publicly, and only if display_consent is true.
    displayName: text("display_name"),
    displayConsent: boolean("display_consent").notNull().default(false),
    contactConsent: boolean("contact_consent").notNull().default(false),
    privacyVersion: text("privacy_version").notNull(),
    consentedAt: timestamp("consented_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("pledgers_id_hash_uq")
      .on(t.idHash)
      .where(sql`${t.idHash} is not null`),
    check(
      "pledgers_id_type_check",
      sql`${t.idType} in ('national_id','passport','alien_id')`,
    ),
  ],
);

// admin
// Declared ahead of payments, which references it.

export const adminUsers = pgTable(
  "admin_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: citext("email").notNull().unique(),
    fullName: text("full_name").notNull(),
    role: text("role").notNull(),
    totpSecret: bytea("totp_secret"),
    isActive: boolean("is_active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "admin_users_role_check",
      sql`${t.role} in ('viewer','treasurer','admin')`,
    ),
  ],
);

// the promise

export const pledgeStatus = pgEnum("pledge_status", [
  "pending",
  "verified",
  "fulfilled",
  "cancelled",
  "void",
]);

export const pledges = pgTable(
  "pledges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id),
    pledgerId: uuid("pledger_id")
      .notNull()
      .references(() => pledgers.id),
    // CF26-000124, max 12 chars, from pledge_ref_seq. See PLAN.md section 6.
    reference: text("reference").notNull().unique(),
    // 22 char nanoid, the QR target. Never the reference in a public URL.
    publicToken: text("public_token").notNull().unique(),
    amountMinor: minor("amount_minor").notNull(),
    currency: char("currency", { length: 3 }).notNull().default("KES"),
    status: pledgeStatus("status").notNull().default("pending"),
    intent: text("intent").notNull().default("one_off"),
    installmentAmountMinor: minor("installment_amount_minor"),
    installmentFrequency: text("installment_frequency"),
    targetCompletionOn: date("target_completion_on"),
    channel: text("channel").notNull().default("web"),
    note: text("note"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("pledges_campaign_status_idx").on(t.campaignId, t.status),
    index("pledges_created_idx").on(t.createdAt.desc()),
    check("pledges_amount_minor_check", sql`${t.amountMinor} > 0`),
    check(
      "pledges_installment_amount_minor_check",
      sql`${t.installmentAmountMinor} > 0`,
    ),
    check("pledges_intent_check", sql`${t.intent} in ('one_off','installment')`),
    check(
      "pledges_installment_frequency_check",
      sql`${t.installmentFrequency} in ('monthly','quarterly','annually')`,
    ),
    check(
      "pledges_channel_check",
      sql`${t.channel} in ('web','admin','event','sms','import')`,
    ),
  ],
);

// money actually received

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id),
    method: text("method").notNull(),
    // M-Pesa receipt, bank slip number.
    externalRef: text("external_ref"),
    amountMinor: minor("amount_minor").notNull(),
    currency: char("currency", { length: 3 }).notNull().default("KES"),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
    // As the channel reported it.
    payerNameRaw: text("payer_name_raw"),
    payerMsisdn: text("payer_msisdn"),
    // What the payer typed, used for matching.
    accountRefRaw: text("account_ref_raw"),
    status: text("status").notNull().default("received"),
    recordedBy: uuid("recorded_by").references(() => adminUsers.id),
    // Full callback body, kept for audit.
    rawPayload: jsonb("raw_payload"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("payments_channel_ref_uq")
      .on(t.method, t.externalRef)
      .where(sql`${t.externalRef} is not null`),
    check("payments_amount_minor_check", sql`${t.amountMinor} > 0`),
    check(
      "payments_method_check",
      sql`${t.method} in ('mpesa','bank','cash','cheque','card','other')`,
    ),
    check(
      "payments_status_check",
      sql`${t.status} in ('received','reversed','disputed')`,
    ),
  ],
);

// linking money to promises

export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    pledgeId: uuid("pledge_id")
      .notNull()
      .references(() => pledges.id),
    amountMinor: minor("amount_minor").notNull(),
    allocatedBy: uuid("allocated_by").references(() => adminUsers.id),
    allocatedAt: timestamp("allocated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    note: text("note"),
  },
  (t) => [
    index("alloc_pledge_idx").on(t.pledgeId),
    check("payment_allocations_amount_minor_check", sql`${t.amountMinor} > 0`),
  ],
);

// snapshots

export const campaignDailyStats = pgTable(
  "campaign_daily_stats",
  {
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id),
    statDate: date("stat_date").notNull(),
    pledgedMinor: minor("pledged_minor").notNull(),
    receivedMinor: minor("received_minor").notNull(),
    pledgeCount: integer("pledge_count").notNull(),
    pledgerCount: integer("pledger_count").notNull(),
    newPledges: integer("new_pledges").notNull(),
    newPledgedMinor: minor("new_pledged_minor").notNull(),
  },
  (t) => [
    primaryKey({
      name: "campaign_daily_stats_pkey",
      columns: [t.campaignId, t.statDate],
    }),
  ],
);

// audit
// Append only. Enforced by trigger, see the views and guards migration.

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorType: text("actor_type").notNull(),
    actorId: uuid("actor_id"),
    // pledge.created, payment.recorded, pledge.voided
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: inet("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [
    check(
      "audit_log_actor_type_check",
      sql`${t.actorType} in ('public','admin','system','webhook')`,
    ),
  ],
);
