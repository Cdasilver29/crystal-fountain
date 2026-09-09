import { headers } from "next/headers";

import { db } from "@/db";
import { getCurrentAdmin } from "@/lib/admin-context";
import { clientIp, serviceProblem, userAgent } from "@/lib/api";
import { getAuth } from "@/lib/auth";
import * as audit from "@/server/services/admin-audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/logout
 *
 * Signing out, wrapped so the audit row is written while the session is still
 * readable. Better Auth's own sign out endpoint would work on its own, but by
 * the time it has answered there is nothing left to say who left.
 *
 * Answers 200 even when there was no session to end. Sign out is not a thing
 * that should fail: the caller wants to be signed out, and they are.
 */
export async function POST(request: Request) {
  try {
    const admin = await getCurrentAdmin();

    if (admin?.id) {
      await audit.recordLogout(db, {
        adminUserId: admin.id,
        email: admin.email ?? "",
        ip: clientIp(request),
        userAgent: userAgent(request),
      });
    }

    // Better Auth clears the cookie. Forwarded whole so the Set-Cookie that
    // expires it survives the wrapping.
    const response = await getAuth()
      .api.signOut({ headers: await headers(), asResponse: true })
      .catch(() => null);

    return response ?? Response.json({ ok: true });
  } catch (error) {
    return serviceProblem(error);
  }
}
