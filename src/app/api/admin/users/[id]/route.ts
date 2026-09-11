import { db } from "@/db";
import { requirePermission } from "@/lib/admin-guard";
import {
  clientIp,
  problem,
  serviceProblem,
  userAgent,
  validationProblem,
} from "@/lib/api";
import { can } from "@/lib/permissions";
import {
  adminUserPathParams,
  updateAdminUserInput,
} from "@/server/contracts/admin-users";
import * as adminUsers from "@/server/services/admin-users";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/users/:id
 *
 * Changes a name, a role, or both. Never an email address: that is the identity
 * key Better Auth signs somebody in by and the login lockout counts against.
 *
 * Who may change what is split in two. Managing users at all is the admin role,
 * and it lets somebody correct a colleague's name. Changing a role is the super
 * administrator's, because a role is what decides who can move money.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const target = adminUserPathParams.safeParse({ adminUserId: id });

  const gate = await requirePermission(request, "users.manage", {
    entity: "admin_users",
    entityId: target.success ? target.data.adminUserId : null,
  });
  if (!gate.ok) return gate.response;

  if (!target.success) {
    return problem(404, "admin_not_found", "That administrator does not exist.");
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return problem(400, "invalid_json", "That request body was not valid JSON.");
  }

  const parsed = updateAdminUserInput.safeParse(body);

  if (!parsed.success) {
    return validationProblem(parsed.error);
  }

  try {
    await adminUsers.update(db, {
      adminUserId: target.data.adminUserId,
      input: parsed.data,
      actorId: gate.admin.id,
      // Promoting somebody to administrator is creating one, so it needs the
      // same permission that creating one does.
      mayChangeRole:
        parsed.data.role === "admin"
          ? can(gate.admin, "users.createAdmin")
          : gate.admin.isSuper,
      request: { ip: clientIp(request), userAgent: userAgent(request) },
    });

    return Response.json({ ok: true });
  } catch (error) {
    return serviceProblem(error);
  }
}

/**
 * DELETE /api/admin/users/:id
 *
 * Retires an account. Never removes the row: it is referenced by every audit
 * entry this person wrote and every payment they recorded, and deleting it
 * would either break those references or quietly take somebody's name off their
 * own work. Deactivating ends their sessions and refuses the next sign in,
 * which is the whole of what deleting was ever meant to achieve.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const target = adminUserPathParams.safeParse({ adminUserId: id });

  const gate = await requirePermission(request, "users.manage", {
    entity: "admin_users",
    entityId: target.success ? target.data.adminUserId : null,
  });
  if (!gate.ok) return gate.response;

  if (!target.success) {
    return problem(404, "admin_not_found", "That administrator does not exist.");
  }

  try {
    await adminUsers.deactivate(db, {
      adminUserId: target.data.adminUserId,
      actorId: gate.admin.id,
      request: { ip: clientIp(request), userAgent: userAgent(request) },
    });

    return Response.json({ ok: true });
  } catch (error) {
    return serviceProblem(error);
  }
}

/**
 * POST /api/admin/users/:id
 *
 * Brings a retired account back, if there is still room under the cap.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const target = adminUserPathParams.safeParse({ adminUserId: id });

  const gate = await requirePermission(request, "users.manage", {
    entity: "admin_users",
    entityId: target.success ? target.data.adminUserId : null,
  });
  if (!gate.ok) return gate.response;

  if (!target.success) {
    return problem(404, "admin_not_found", "That administrator does not exist.");
  }

  try {
    await adminUsers.reactivate(db, {
      adminUserId: target.data.adminUserId,
      actorId: gate.admin.id,
      request: { ip: clientIp(request), userAgent: userAgent(request) },
    });

    return Response.json({ ok: true });
  } catch (error) {
    return serviceProblem(error);
  }
}
