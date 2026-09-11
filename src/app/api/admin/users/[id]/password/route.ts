import { webcrypto } from "node:crypto";

import { db } from "@/db";
import { requirePermission } from "@/lib/admin-guard";
import { authAccountWriter } from "@/lib/auth-accounts";
import { clientIp, problem, serviceProblem, userAgent } from "@/lib/api";
import {
  adminUserPathParams,
  generateTemporaryPassword,
} from "@/server/contracts/admin-users";
import * as adminUsers from "@/server/services/admin-users";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/users/:id/password
 *
 * Resets somebody's password and ends every session they have open.
 *
 * The new password comes back once, in this response, and exists nowhere else:
 * not in audit_log, not readable in the database, not retrievable afterwards.
 * The journal records that a reset happened and who did it, which is what a
 * journal is for.
 *
 * Resetting your own password this way is refused. It would replace a password
 * you know with one you have to read off a screen, and the change password
 * screen is where that belongs.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const target = adminUserPathParams.safeParse({ adminUserId: id });

  const gate = await requirePermission(request, "users.resetPassword", {
    entity: "admin_users",
    entityId: target.success ? target.data.adminUserId : null,
  });
  if (!gate.ok) return gate.response;

  if (!target.success) {
    return problem(404, "admin_not_found", "That administrator does not exist.");
  }

  if (target.data.adminUserId === gate.admin.id) {
    return problem(
      409,
      "self_reset",
      "Use the change password screen to set your own password.",
    );
  }

  const temporaryPassword = generateTemporaryPassword((n) =>
    webcrypto.getRandomValues(new Uint8Array(n)),
  );

  try {
    const auth = await authAccountWriter();

    await adminUsers.resetPassword(db, auth, {
      adminUserId: target.data.adminUserId,
      temporaryPassword,
      actorId: gate.admin.id,
      request: { ip: clientIp(request), userAgent: userAgent(request) },
    });

    return Response.json({ temporaryPassword });
  } catch (error) {
    return serviceProblem(error);
  }
}
