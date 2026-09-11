import { db } from "@/db";
import { getCurrentAdmin } from "@/lib/admin-context";
import { authAccountWriter } from "@/lib/auth-accounts";
import {
  clientIp,
  problem,
  serviceProblem,
  userAgent,
  validationProblem,
} from "@/lib/api";
import { changeOwnPasswordInput } from "@/server/contracts/admin-users";
import * as adminUsers from "@/server/services/admin-users";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/change-password
 *
 * The one route that deliberately does not go through requirePermission.
 *
 * The guard refuses every action while force_password_change is set, which is
 * the point of the flag, so routing this through it would leave somebody who
 * has been given a temporary password with no way to stop using it. It checks
 * the session itself instead, and needs no permission beyond being signed in:
 * setting your own password is not an action against anybody else.
 */
export async function POST(request: Request) {
  const admin = await getCurrentAdmin();

  if (!admin) {
    return problem(401, "unauthenticated", "Sign in to continue.");
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return problem(400, "invalid_json", "That request body was not valid JSON.");
  }

  const parsed = changeOwnPasswordInput.safeParse(body);

  if (!parsed.success) {
    return validationProblem(parsed.error);
  }

  try {
    const auth = await authAccountWriter();

    await adminUsers.changeOwnPassword(db, auth, {
      adminUserId: admin.id,
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
      request: { ip: clientIp(request), userAgent: userAgent(request) },
    });

    return Response.json({ ok: true });
  } catch (error) {
    return serviceProblem(error);
  }
}
