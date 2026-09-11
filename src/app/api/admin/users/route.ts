import { webcrypto } from "node:crypto";

import { db } from "@/db";
import { requirePermission } from "@/lib/admin-guard";
import { authAccountWriter } from "@/lib/auth-accounts";
import {
  clientIp,
  problem,
  serviceProblem,
  userAgent,
  validationProblem,
} from "@/lib/api";
import { can } from "@/lib/permissions";
import {
  createAdminUserInput,
  generateTemporaryPassword,
} from "@/server/contracts/admin-users";
import * as adminUsers from "@/server/services/admin-users";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/users
 *
 * Everyone with an account, and whether there is room for another.
 */
export async function GET(request: Request) {
  const gate = await requirePermission(request, "users.manage", {
    entity: "admin_users",
  });
  if (!gate.ok) return gate.response;

  try {
    const [rows, capacity] = await Promise.all([
      adminUsers.list(db),
      adminUsers.capacity(db),
    ]);

    return Response.json({
      capacity,
      users: rows.map((row) => ({
        ...row,
        lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return serviceProblem(error);
  }
}

/**
 * POST /api/admin/users
 *
 * Adds somebody, with a temporary password returned exactly once.
 *
 * The password is in the response and nowhere else: not in audit_log, not in
 * the database in any readable form, and not retrievable afterwards. Whoever
 * created the account has one chance to pass it on, and a reset is how a missed
 * one is recovered.
 */
export async function POST(request: Request) {
  const gate = await requirePermission(request, "users.manage", {
    entity: "admin_users",
  });
  if (!gate.ok) return gate.response;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return problem(400, "invalid_json", "That request body was not valid JSON.");
  }

  const parsed = createAdminUserInput.safeParse(body);

  if (!parsed.success) {
    return validationProblem(parsed.error);
  }

  /*
   * Creating an administrator is the super administrator's alone, and it is
   * checked here rather than inside the service because it is a question about
   * the caller and not about the account being made. Anybody who manages users
   * can still create a viewer or a treasurer.
   */
  if (parsed.data.role === "admin" && !can(gate.admin, "users.createAdmin")) {
    return problem(
      403,
      "forbidden",
      "Only the super administrator can create another administrator.",
    );
  }

  const temporaryPassword = generateTemporaryPassword((n) =>
    webcrypto.getRandomValues(new Uint8Array(n)),
  );

  try {
    const auth = await authAccountWriter();

    const result = await adminUsers.create(db, auth, {
      input: parsed.data,
      temporaryPassword,
      actorId: gate.admin.id,
      request: { ip: clientIp(request), userAgent: userAgent(request) },
    });

    return Response.json(
      {
        adminUserId: result.adminUserId,
        email: parsed.data.email,
        // Shown once, on screen, and never again from anywhere.
        temporaryPassword,
      },
      { status: 201 },
    );
  } catch (error) {
    return serviceProblem(error);
  }
}
