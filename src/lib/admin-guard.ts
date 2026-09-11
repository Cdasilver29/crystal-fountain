import { db } from "@/db";
import { clientIp, problem, userAgent } from "@/lib/api";
import { getCurrentAdmin, type CurrentAdmin } from "@/lib/admin-context";
import { can, refusalReason, type AdminAction } from "@/lib/permissions";
import * as adminAudit from "@/server/services/admin-audit";

/**
 * The one gate every admin route goes through.
 *
 * Before this, each route repeated four things: fetch the admin, refuse if
 * absent, check a role, write the forbidden audit row. Four things repeated
 * fifteen times is four things that can be forgotten once, and the one that
 * gets forgotten is always the audit row, because nothing breaks when it is
 * missing. Here it cannot be forgotten: refusing and recording the refusal are
 * the same line of code.
 *
 * Returns either the admin or a ready made response. The caller writes
 *
 *   const gate = await requirePermission(request, "pledges.edit", { entity });
 *   if (!gate.ok) return gate.response;
 *
 * and then has a typed admin who is definitely allowed to be there.
 */

export type Gate =
  | { ok: true; admin: CurrentAdmin }
  | { ok: false; response: Response };

export async function requirePermission(
  request: Request,
  action: AdminAction,
  context: { entity: string; entityId?: string | null } = { entity: "admin" },
): Promise<Gate> {
  const admin = await getCurrentAdmin();

  if (!admin) {
    // Not signed in, so there is nobody to attribute a row to. An anonymous
    // probe against an admin route is a middleware and login concern, not an
    // entry in the journal of what administrators did.
    return {
      ok: false,
      response: problem(401, "unauthenticated", "Sign in to continue."),
    };
  }

  /*
   * A temporary password is still somebody else's password. Until it has been
   * changed, this account can do exactly one thing, and it is not this.
   */
  if (admin.mustChangePassword) {
    return {
      ok: false,
      response: problem(
        403,
        "password_change_required",
        "Set a new password before using the portal.",
      ),
    };
  }

  if (!can(admin, action)) {
    await adminAudit.recordForbidden(db, {
      adminUserId: admin.id,
      role: admin.isSuper ? `${admin.role} (super)` : admin.role,
      attempted: action,
      entity: context.entity,
      entityId: context.entityId ?? null,
      ip: clientIp(request),
      userAgent: userAgent(request),
    });

    return {
      ok: false,
      response: problem(403, "forbidden", refusalReason(action)),
    };
  }

  return { ok: true, admin };
}

/**
 * The same question for a page rather than a route.
 *
 * Pages redirect rather than returning problem+json, and a page render is a
 * read: somebody landing on a screen their role cannot use has not attempted an
 * action, so nothing is written to the journal. The route behind the buttons on
 * that screen is what records an actual attempt.
 */
export async function pageAdmin(
  action: AdminAction,
): Promise<CurrentAdmin | null> {
  const admin = await getCurrentAdmin();

  if (!admin || admin.mustChangePassword) return null;

  return can(admin, action) ? admin : null;
}
