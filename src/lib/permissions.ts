import type { AdminRole, CurrentAdmin } from "@/lib/admin-context";

/**
 * Who may do what in the admin portal.
 *
 * One table, in one file, read by every route and by the nav. Before this, each
 * route carried its own hasAtLeast check and the answer to "can a treasurer
 * deallocate a payment" was spread across a dozen files with no way to see it
 * whole. A permission model nobody can read in one sitting is a permission
 * model nobody can audit.
 *
 * This is presentation for the nav and enforcement for the routes. Hiding a
 * link is never what stops anybody: the route makes the same call and writes an
 * admin.forbidden row when it refuses.
 *
 * The four levels are cumulative except for super, which is a flag and not a
 * rank. A super admin is an admin who also holds the powers that can quietly
 * rewrite what the congregation sees.
 */

/** Everything the portal can be asked to do. */
export const ADMIN_ACTIONS = [
  "pledges.view",
  "pledges.viewPhone",
  "pledges.approve",
  "pledges.void",
  "pledges.edit",
  "pledges.delete",
  "pledges.create",
  "payments.view",
  "payments.record",
  "payments.allocate",
  "payments.deallocate",
  "exports.download",
  "analytics.view",
  "audit.view",
  "users.manage",
  "users.resetPassword",
  "users.createAdmin",
  "settings.edit",
] as const;

export type AdminAction = (typeof ADMIN_ACTIONS)[number];

/**
 * The least role each action needs, and whether it needs the super flag too.
 *
 * "super" is not a role. It sits beside one, so an action marked super still
 * requires the admin role underneath it, which the database check constraint on
 * admin_users guarantees can never be anything else.
 */
type Rule = { minRole: AdminRole; superOnly?: true };

const RULES: Record<AdminAction, Rule> = {
  // Reading. Every signed in admin, whatever their role, can see the books.
  "pledges.view": { minRole: "viewer" },
  "payments.view": { minRole: "viewer" },
  "analytics.view": { minRole: "viewer" },

  /*
   * A whole phone number, rather than the masked one every screen shows.
   * A treasurer reconciling an M-Pesa receipt against a pledge needs it; a
   * viewer has no task that does, so they keep seeing the last three digits.
   */
  "pledges.viewPhone": { minRole: "treasurer" },

  // Moving money about. The treasurer's job.
  "pledges.approve": { minRole: "treasurer" },
  "pledges.void": { minRole: "treasurer" },
  "pledges.create": { minRole: "treasurer" },
  "payments.record": { minRole: "treasurer" },
  "payments.allocate": { minRole: "treasurer" },
  "exports.download": { minRole: "treasurer" },

  /*
   * Undoing and rewriting. An allocation is the treasurer's own work, and the
   * point of a reversal is that somebody other than its author signs it off.
   */
  "payments.deallocate": { minRole: "admin" },
  "pledges.edit": { minRole: "admin" },

  /*
   * The journal records what the treasurer did, and a record its own subjects
   * can read is a weaker record.
   */
  "audit.view": { minRole: "admin" },

  "users.manage": { minRole: "admin" },
  "users.resetPassword": { minRole: "admin" },

  /*
   * The three that can quietly rewrite what the congregation sees, or hand
   * somebody else the ability to. Deleting a pledge takes money off the public
   * total; changing the settings moves the target or the paybill that donations
   * are sent to; creating an administrator creates another person who can do
   * the rest. One named person holds these.
   */
  "pledges.delete": { minRole: "admin", superOnly: true },
  "settings.edit": { minRole: "admin", superOnly: true },
  "users.createAdmin": { minRole: "admin", superOnly: true },
};

const RANK: Record<AdminRole, number> = { viewer: 1, treasurer: 2, admin: 3 };

/** Whether this admin may perform this action. */
export function can(
  admin: Pick<CurrentAdmin, "role" | "isSuper">,
  action: AdminAction,
): boolean {
  const rule = RULES[action];

  if (RANK[admin.role] < RANK[rule.minRole]) return false;
  if (rule.superOnly && !admin.isSuper) return false;

  return true;
}

/**
 * Why an action was refused, in words a person can act on.
 *
 * The message says what is required rather than merely that the answer is no,
 * because an administrator who cannot delete a pledge needs to know it is the
 * super administrator who can, not that something went wrong.
 */
export function refusalReason(action: AdminAction): string {
  const rule = RULES[action];

  if (rule.superOnly) {
    return "Only the super administrator can do this.";
  }

  return rule.minRole === "admin"
    ? "Your account needs the administrator role to do this."
    : "Your account needs at least the treasurer role to do this.";
}

/** The whole table, for the nav and for the verification script. */
export function rulesFor(action: AdminAction): Readonly<Rule> {
  return RULES[action];
}
