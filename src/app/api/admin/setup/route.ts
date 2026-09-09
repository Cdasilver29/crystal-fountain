import { db } from "@/db";
import { clientIp, problem, serviceProblem, userAgent, validationProblem } from "@/lib/api";
import { getAuth } from "@/lib/auth";
import { adminSetupInput } from "@/server/contracts/auth";
import {
  createFirstAdmin,
  isSetupAvailable,
  type AuthProvisioner,
} from "@/server/services/admin-setup";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/setup
 *
 * Creates the very first administrator, and only while there is not one
 * already. Public by necessity: there is nobody to authenticate as yet. The
 * gate is that both admin_users and Better Auth's user table are empty, which
 * the service re-checks inside its transaction.
 */
export async function POST(request: Request) {
  if (!(await isSetupAvailable(db))) {
    // Same answer the page gives, so probing this endpoint tells an attacker
    // nothing the page would not.
    return problem(404, "not_found", "This page does not exist.");
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return problem(400, "invalid_json", "That request body was not valid JSON.");
  }

  const parsed = adminSetupInput.safeParse(body);

  if (!parsed.success) {
    return validationProblem(parsed.error);
  }

  const auth = getAuth();
  const ctx = await auth.$context;

  // Adapts Better Auth's context to the narrow interface the service takes, so
  // the service itself stays free of the library.
  const provisioner: AuthProvisioner = {
    hashPassword: (password) => ctx.password.hash(password),
    createUser: async ({ name, email }) => {
      const user = await ctx.internalAdapter.createUser(
        { name, email, emailVerified: false },
        { method: "email-password" },
      );
      return { id: user.id };
    },
    createCredentialAccount: async ({ userId, passwordHash }) => {
      await ctx.internalAdapter.createAccount({
        userId,
        // Better Auth looks the credential up by this provider id.
        providerId: "credential",
        accountId: userId,
        password: passwordHash,
      });
    },
    deleteUser: (userId) => ctx.internalAdapter.deleteUser(userId),
  };

  try {
    const result = await createFirstAdmin(db, provisioner, {
      fullName: parsed.data.fullName,
      email: parsed.data.email,
      password: parsed.data.password,
      ip: clientIp(request),
      userAgent: userAgent(request),
    });

    if (!result.ok) {
      return problem(404, "not_found", "This page does not exist.");
    }

    // No session is issued here on purpose. The new admin signs in through the
    // normal login screen, which is also where TOTP enrolment happens.
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    return serviceProblem(error);
  }
}
