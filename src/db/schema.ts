import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
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
    /*
     * Whether the campaign is open to the public.
     *
     * False closes the pledge form: the public endpoint refuses a new pledge
     * and the page says so. The figures stay visible either way, because they
     * are already public knowledge and making them vanish mid campaign would
     * alarm a congregation watching them.
     */
    isPublic: boolean("is_public").notNull().default(false),
    /*
     * The ceiling for approving a pledge without a person looking at it, in
     * minor units, or null to fall back to PLEDGE_AUTO_APPROVE_LIMIT_KES.
     *
     * Here as well as in the environment because the treasurer needs to move it
     * on a Sabbath morning without a deploy. The environment variable stays the
     * default a fresh installation starts from.
     */
    autoApproveLimitMinor: minor("auto_approve_limit_minor"),
    /*
     * Where the money is sent.
     *
     * In the database rather than the repo because these change without a code
     * release, and a wrong number here misdirects real money, so each change is
     * an audited write by one named person rather than a commit nobody reviews.
     * Nullable throughout: an installation that has not filled them in falls
     * back to the values in src/content/campaign.ts.
     */
    mpesaPaybill: text("mpesa_paybill"),
    mpesaAccountName: text("mpesa_account_name"),
    bankName: text("bank_name"),
    bankBranch: text("bank_branch"),
    bankAccountName: text("bank_account_name"),
    bankAccount: text("bank_account"),
    bankSwift: text("bank_swift"),
    bankBranchCode: text("bank_branch_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("campaigns_target_minor_check", sql`${t.targetMinor} > 0`),
    check(
      "campaigns_opening_balance_check",
      sql`${t.openingBalanceMinor} >= 0`,
    ),
    check(
      "campaigns_auto_approve_limit_check",
      sql`${t.autoApproveLimitMinor} is null or ${t.autoApproveLimitMinor} > 0`,
    ),
  ],
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
    /*
     * What the public sees, verbatim, when the treasurer has set it by hand.
     *
     * Null means automatic: the name is derived from display_name by
     * src/server/display-name.ts. When set it overrides both the derivation
     * and the organisation flag, because a person has decided this exact
     * string is safe to publish. full_name is never touched by it.
     */
    publicDisplayName: text("public_display_name"),
    contactConsent: boolean("contact_consent").notNull().default(false),
    /*
     * Whether this pledger is an organisation rather than a person.
     *
     * A fund, a ministry or a choir has no surname to protect, so its stored
     * name is published in full. An individual's is reduced to a given name and
     * an initial. Nothing infers this: a heuristic over the real display names
     * was tried and "Family" turned out to mean a real family with a real
     * surname five times out of seven, so the flag is set deliberately by the
     * treasurer on the pledge screen and the audit log records who decided.
     *
     * Defaults to false, which is the safe answer for a row nobody has looked
     * at yet: a person's name rendered as an organisation's would publish their
     * surname, and an organisation rendered as a person only reads oddly.
     */
    isOrganisation: boolean("is_organisation").notNull().default(false),
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
    isActive: boolean("is_active").notNull().default(true),
    /*
     * The first administrator, created through /admin/setup.
     *
     * One of these exists and no more, which the partial unique index below
     * enforces rather than leaving to application code. The super admin cannot
     * be deactivated or deleted by anybody, is the only account that can create
     * another admin, change campaign settings or delete a pledge, and is
     * therefore the account the whole portal ultimately answers to.
     */
    isSuper: boolean("is_super").notNull().default(false),
    /*
     * Set when somebody else has reset this account's password.
     *
     * A temporary password is known to whoever generated it, so an account
     * carrying one is not yet the owner's. While this is true every admin page
     * sends them to the change password screen and nowhere else.
     */
    forcePasswordChange: boolean("force_password_change")
      .notNull()
      .default(false),
    /*
     * The Better Auth user this admin signs in as, once they have one.
     *
     * Nullable on purpose, so an admin_users row can be created before its
     * credential exists. Role and is_active stay here rather than moving into
     * the library's tables.
     */
    authUserId: text("auth_user_id")
      .unique()
      // Declared with the callback form because auth_users is declared further
      // down this file. Deleting the Better Auth user detaches the admin row
      // rather than destroying the audit trail attached to it.
      .references((): AnyPgColumn => authUsers.id, { onDelete: "set null" }),
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
    /*
     * Exactly one super admin, enforced here rather than in application code.
     *
     * A second one would be a second account able to create administrators,
     * change the campaign target and delete pledges, and the whole point of the
     * flag is that those powers sit with one named person. A partial unique
     * index says so in the one place that cannot be bypassed.
     */
    uniqueIndex("admin_users_one_super_idx")
      .on(t.isSuper)
      .where(sql`is_super`),
    /* A super admin is an admin. Any other combination is a mistake. */
    check(
      "admin_users_super_is_admin_check",
      sql`not ${t.isSuper} or ${t.role} = 'admin'`,
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
    /*
     * When an administrator removed this pledge.
     *
     * The row never goes. It is a financial record, it is referenced by every
     * audit entry about it, and its increments and any payment allocations hang
     * off it. Setting this takes it out of every total, every list and every
     * export, which is the whole of what deleting was meant to achieve, while
     * leaving the evidence that it once existed.
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
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
      sql`${t.installmentFrequency} in ('monthly','quarterly','semi_annually','annually')`,
    ),
    check(
      "pledges_channel_check",
      sql`${t.channel} in ('web','admin','event','sms','import')`,
    ),
    /*
     * One live pledge per person per campaign.
     *
     * A second submission from the same phone number adds to this row instead
     * of making another one, and two submissions arriving together could both
     * read nothing and both insert. The predicate matches the status filter the
     * accumulation query uses: a fulfilled, cancelled or void pledge is
     * finished and does not stand in the way of a fresh one. See migration 0005.
     */
    uniqueIndex("pledges_one_live_per_pledger_idx")
      .on(t.campaignId, t.pledgerId)
      .where(sql`status in ('pending','verified') and deleted_at is null`),
  ],
);

/*
 * What a pledge is made of.
 *
 * One row per submission. The pledge row accumulates, this table remembers how
 * it got there, and a deferred constraint trigger holds pledges.amount_minor
 * equal to the sum of its increments at every commit. CLAUDE.md: corrections
 * are new rows, not edits, and a running total kept only by UPDATE would leave
 * nothing behind to audit against.
 */
export const pledgeIncrements = pgTable(
  "pledge_increments",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    /*
     * Cascading, because an increment is part of a pledge rather than a record
     * that outlives one. Nothing else references it, and a pledge that is
     * deleted outright leaving its parts behind would be an orphan that no
     * balance could ever reconcile.
     */
    pledgeId: uuid("pledge_id")
      .notNull()
      .references(() => pledges.id, { onDelete: "cascade" }),
    amountMinor: minor("amount_minor").notNull(),
    channel: text("channel").notNull().default("web"),
    // Which tab and which tier the pledger picked on the form. Analytics only.
    // Neither column changes what the pledge does.
    category: text("category"),
    tier: text("tier"),
    /*
     * Why an administrator corrected the amount.
     *
     * Required on any increment that takes money away, and null on an ordinary
     * submission, which needs no explanation beyond itself. A correction to a
     * figure the congregation can see is the one kind of write where the number
     * alone is not enough of a record.
     */
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("pledge_increments_pledge_idx").on(t.pledgeId, t.createdAt),
    // Zero is not a correction, it is a no-op with an audit row attached.
    check("pledge_increments_amount_minor_check", sql`${t.amountMinor} <> 0`),
    /*
     * An increment may be negative, but only an administrator's, and only with
     * a reason written down. A pledger's submission can never subtract: the
     * form has no way to express it and a robot should not discover one.
     */
    check(
      "pledge_increments_adjustment_check",
      sql`${t.amountMinor} > 0
          or (${t.channel} = 'admin'
              and ${t.reason} is not null
              and length(trim(${t.reason})) > 0)`,
    ),
    check(
      "pledge_increments_channel_check",
      sql`${t.channel} in ('web','admin','event','sms','import')`,
    ),
    check(
      "pledge_increments_category_check",
      sql`${t.category} is null or ${t.category} in ('family','individual')`,
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
    /*
     * Reversal, not deletion.
     *
     * CLAUDE.md: corrections are new rows, not edits. An allocation drives
     * v_pledge_balances.paid_minor, so removing one by deleting the row would
     * destroy the fact that the money was ever matched to that pledge and
     * leave only an audit_log entry to remember it. Setting reversed_at keeps
     * both facts. A negative compensating row is not available here, because
     * payment_allocations_amount_minor_check requires a positive amount.
     *
     * v_pledge_balances and assert_allocation_within_payment() both ignore a
     * reversed row, so a reversal is invisible to every balance and frees the
     * amount for reallocation. See migration 0004.
     */
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by").references(() => adminUsers.id),
  },
  (t) => [
    index("alloc_pledge_idx").on(t.pledgeId),
    // Every allocation and every reversal sums the live allocations for one
    // payment, and that sum had no index to read.
    index("alloc_payment_idx").on(t.paymentId),
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

// better auth
//
// Better Auth owns these six tables outright. They are declared here rather
// than generated so drizzle-kit sees them and the migration is checked into the
// repo like every other one.
//
// Two things are deliberate. The drizzle property names are Better Auth's field
// names verbatim (emailVerified, not email_verified), because the drizzle
// adapter indexes the table object by field name and silently fails to match
// otherwise. The physical tables are prefixed auth_, both because "user" is a
// reserved word in Postgres and because it should be obvious at a glance which
// tables this project owns and which the library does.
//
// admin_users gains one nullable column and loses the totp_secret that
// predated the plugin. Better Auth does not adopt it as its user table:
// admin_users.id is a uuid, and adopting it would put role and is_active under
// the library's lifecycle.

export const authUsers = pgTable("auth_users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: citext("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  // Set by the two factor plugin once TOTP is verified.
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    /*
     * How this session was opened, "password" or "google".
     *
     * Nullable because every session that existed before this column did, and
     * a null reads as "opened before we started recording it" rather than as
     * either method. Written once at creation and never updated: Better Auth
     * rolls the idle window forward on use, and a session does not change how
     * it was opened.
     *
     * It decides what the portal may assume about the second factor. A
     * password session has been through TOTP; a Google one has been through
     * Google's own protection instead. See the note in src/lib/auth.ts.
     */
    signInMethod: text("sign_in_method"),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("auth_sessions_user_id_idx").on(t.userId)],
);

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    // The scrypt hash for the credential provider. Never the password.
    password: text("password"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("auth_accounts_user_id_idx").on(t.userId)],
);

export const authVerifications = pgTable(
  "auth_verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("auth_verifications_identifier_idx").on(t.identifier)],
);

export const authTwoFactors = pgTable(
  "auth_two_factors",
  {
    id: text("id").primaryKey(),
    // The TOTP shared secret, and the encoded backup codes. Both are secrets
    // and neither is ever returned to a client by the plugin.
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    verified: boolean("verified").default(true),
    failedVerificationCount: integer("failed_verification_count").default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
  },
  (t) => [
    index("auth_two_factors_user_id_idx").on(t.userId),
    index("auth_two_factors_secret_idx").on(t.secret),
  ],
);

/** Better Auth's own limiter, keyed on ip and path. Not the per email rule. */
export const authRateLimits = pgTable("auth_rate_limits", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

/**
 * Failed admin logins, for the per email lockout.
 *
 * Better Auth's limiter keys on ip and path and counts every request rather
 * than every failure, so it cannot express "five failures for this account in
 * fifteen minutes". This table can. Only failures are written, and a successful
 * login clears the account's rows, so the count is always consecutive failures.
 */
export const adminLoginAttempts = pgTable(
  "admin_login_attempts",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    email: citext("email").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    ip: inet("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("admin_login_attempts_email_at_idx").on(t.email, t.at)],
);

/*
 * Every attempt to look a pledge up on /redeem.
 *
 * The rate limit is counted from here rather than from memory, so it holds
 * across every serverless instance and survives a redeploy, which an in process
 * counter would not. Both successes and failures are recorded: a limiter that
 * only counted failures would let somebody who has found one real pledge walk
 * the rest at full speed.
 *
 * The IP is nullable because clientIp() returns null for anything that is not
 * plausibly an address, and a request with no usable address still has to be
 * counted somewhere rather than silently exempted. See the service.
 */
export const pledgeLookups = pgTable(
  "pledge_lookups",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    ip: inet("ip"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    /** Whether the reference and phone pair actually matched a pledge. */
    found: boolean("found").notNull(),
  },
  (t) => [index("pledge_lookups_ip_at_idx").on(t.ip, t.at)],
);

/*
 * Every request to the public pledgers list.
 *
 * A table of its own rather than a column on pledge_lookups. That table records
 * attempts to find one specific pledge from a reference and a phone number, and
 * its `found` flag is a security signal: somebody walking references shows up
 * there as a run of misses. Browsing a public page is neither of those things,
 * and mixing the two would put noise through a signal the treasurer relies on.
 *
 * Counted from here rather than from memory for the same reason as the lookup
 * limit: it has to hold across every serverless instance and survive a
 * redeploy, which an in process counter on Vercel does not.
 *
 * The IP is nullable because clientIp() returns null for anything that is not
 * plausibly an address, and a request with no usable address still has to be
 * counted somewhere rather than silently exempted.
 */
export const publicListRequests = pgTable(
  "public_list_requests",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    ip: inet("ip"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("public_list_requests_ip_at_idx").on(t.ip, t.at)],
);

/*
 * What a pledger has asked to have changed about their pledge.
 *
 * Everything that is not an increase. Increasing is already the pledge form's
 * job: it recognises the phone number and adds to the pledge that is there, so
 * it needs no review and has no row here. Reducing, re-planning, correcting a
 * name, reporting a payment that never showed up and cancelling all do need
 * one, because each of them either moves a figure the congregation is watching
 * or changes what is published about a person.
 *
 * The authentication behind a row here is the /redeem pairing: a reference and
 * the phone number that matches it. That is enough to ask, and deliberately not
 * enough to change anything. Nothing in this table touches a pledge on its own.
 * An administrator decides, and the decision is a separate write.
 *
 * The kind columns are one table rather than five, because the queue the
 * treasurer works through is one list. What keeps that honest is a check
 * constraint per kind: a reduce_amount with no amount, or a correct_name
 * carrying a payment reference, is refused by the database and not only by the
 * contract in front of it.
 */
export const pledgeChangeRequests = pgTable(
  "pledge_change_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /*
     * Not cascading, unlike pledge_increments. An increment is part of a
     * pledge; a request is a thing a person did, and it stays readable after
     * the pledge it was about is gone. A pledge is soft deleted anyway, so the
     * reference never dangles in practice.
     */
    pledgeId: uuid("pledge_id")
      .notNull()
      .references(() => pledges.id),
    kind: text("kind").notNull(),
    /** reduce_amount only. Minor units, like every other amount here. */
    requestedAmountMinor: minor("requested_amount_minor"),
    /** change_plan only. one_off, or one of the instalment frequencies. */
    requestedFrequency: text("requested_frequency"),
    /** correct_name only. */
    requestedName: text("requested_name"),
    /** payment_missing only. The M-Pesa code or bank slip they paid with. */
    paymentReference: text("payment_reference"),
    /** payment_missing only. What they say they paid. */
    paymentAmountMinor: minor("payment_amount_minor"),
    /** payment_missing only. */
    paymentPaidOn: date("payment_paid_on"),
    /** Why, in their own words. Required whatever the kind. */
    reason: text("reason").notNull(),
    contactPhoneE164: text("contact_phone_e164").notNull(),
    status: text("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => adminUsers.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    sourceIp: inet("source_ip"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /*
     * One open request per pledge.
     *
     * Somebody who has asked for their pledge to be reduced and then asks for
     * it to be cancelled has given the treasurer two answers to act on, and
     * acting on both is how a pledge ends up reduced and then cancelled at the
     * wrong figure. The partial index says so where nothing can bypass it: a
     * decided or closed request is finished and does not stand in the way of a
     * fresh one.
     */
    uniqueIndex("pledge_change_requests_one_pending_idx")
      .on(t.pledgeId)
      .where(sql`status = 'pending'`),

    /** The admin queue reads one status at a time, newest first. */
    index("pledge_change_requests_status_created_idx").on(
      t.status,
      t.createdAt.desc(),
    ),

    check(
      "pledge_change_requests_kind_check",
      sql`${t.kind} in ('reduce_amount','change_plan','correct_name','payment_missing','cancel_pledge')`,
    ),
    check(
      "pledge_change_requests_status_check",
      sql`${t.status} in ('pending','approved','declined','closed')`,
    ),
    /* The same floor the contract keeps, so neither can be the soft one. */
    check(
      "pledge_change_requests_reason_check",
      sql`length(trim(${t.reason})) >= 10`,
    ),
    check(
      "pledge_change_requests_frequency_check",
      sql`${t.requestedFrequency} is null
          or ${t.requestedFrequency} in ('one_off','monthly','quarterly','semi_annually','annually')`,
    ),
    check(
      "pledge_change_requests_amounts_check",
      sql`(${t.requestedAmountMinor} is null or ${t.requestedAmountMinor} > 0)
          and (${t.paymentAmountMinor} is null or ${t.paymentAmountMinor} > 0)`,
    ),

    /*
     * One check per kind, each naming every column: the ones that kind needs,
     * and the ones it must not carry. Five checks rather than one expression
     * over all of them, so a refusal names the kind it was refused for and
     * whoever reads the error knows which rule they broke.
     */
    check(
      "pledge_change_requests_reduce_amount_check",
      sql`${t.kind} <> 'reduce_amount'
          or (${t.requestedAmountMinor} is not null
              and ${t.requestedFrequency} is null
              and ${t.requestedName} is null
              and ${t.paymentReference} is null
              and ${t.paymentAmountMinor} is null
              and ${t.paymentPaidOn} is null)`,
    ),
    check(
      "pledge_change_requests_change_plan_check",
      sql`${t.kind} <> 'change_plan'
          or (${t.requestedFrequency} is not null
              and ${t.requestedAmountMinor} is null
              and ${t.requestedName} is null
              and ${t.paymentReference} is null
              and ${t.paymentAmountMinor} is null
              and ${t.paymentPaidOn} is null)`,
    ),
    check(
      "pledge_change_requests_correct_name_check",
      sql`${t.kind} <> 'correct_name'
          or (${t.requestedName} is not null
              and length(trim(${t.requestedName})) >= 2
              and ${t.requestedAmountMinor} is null
              and ${t.requestedFrequency} is null
              and ${t.paymentReference} is null
              and ${t.paymentAmountMinor} is null
              and ${t.paymentPaidOn} is null)`,
    ),
    check(
      "pledge_change_requests_payment_missing_check",
      sql`${t.kind} <> 'payment_missing'
          or (${t.paymentReference} is not null
              and length(trim(${t.paymentReference})) > 0
              and ${t.paymentAmountMinor} is not null
              and ${t.paymentPaidOn} is not null
              and ${t.requestedAmountMinor} is null
              and ${t.requestedFrequency} is null
              and ${t.requestedName} is null)`,
    ),
    check(
      "pledge_change_requests_cancel_pledge_check",
      sql`${t.kind} <> 'cancel_pledge'
          or (${t.requestedAmountMinor} is null
              and ${t.requestedFrequency} is null
              and ${t.requestedName} is null
              and ${t.paymentReference} is null
              and ${t.paymentAmountMinor} is null
              and ${t.paymentPaidOn} is null)`,
    ),

    /*
     * A pending request has not been decided, and a decided one has a date on
     * it. Closed is the exception on the actor: a request whose pledge was
     * voided underneath it is closed by the system, and there is no
     * administrator to attribute that to.
     */
    check(
      "pledge_change_requests_decision_check",
      sql`case ${t.status}
            when 'pending' then ${t.decidedAt} is null and ${t.decidedBy} is null
            when 'closed' then ${t.decidedAt} is not null
            else ${t.decidedAt} is not null and ${t.decidedBy} is not null
          end`,
    ),
  ],
);
