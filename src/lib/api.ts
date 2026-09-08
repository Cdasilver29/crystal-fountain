import type { ZodError } from "zod";

import { isServiceError } from "@/server/errors";

/**
 * Route handler helpers.
 *
 * Errors go out as application/problem+json with a stable machine readable
 * code, per PLAN.md section 13. Handlers stay thin: parse, call the service,
 * format.
 */

type Problem = {
  code: string;
  title: string;
  status: number;
  detail?: string;
  errors?: Record<string, string>;
};

export function problem(
  status: number,
  code: string,
  title: string,
  extra?: { detail?: string; errors?: Record<string, string> },
): Response {
  const body: Problem = { code, title, status, ...extra };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/problem+json" },
  });
}

/** Flattens a Zod error into one message per field, for the form to display. */
export function validationProblem(error: ZodError): Response {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    if (!errors[key]) errors[key] = issue.message;
  }
  return problem(422, "validation_failed", "Some details need fixing.", {
    errors,
  });
}

/** Maps a thrown ServiceError to its problem response, or rethrows. */
export function serviceProblem(error: unknown): Response {
  if (isServiceError(error)) {
    return problem(error.status, error.code, error.message);
  }
  console.error(error);
  return problem(500, "internal_error", "Something went wrong on our side.");
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const IPV6 = /^[0-9a-f:]+$/i;

/**
 * The caller's IP, or null.
 *
 * audit_log.ip is an inet column, so anything that is not plausibly an address
 * has to become null rather than poison the insert.
 */
export function clientIp(request: Request): string | null {
  const header =
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-real-ip") ??
    "";
  const candidate = header.split(",")[0]?.trim() ?? "";
  if (!candidate) return null;
  if (IPV4.test(candidate) || (candidate.includes(":") && IPV6.test(candidate))) {
    return candidate;
  }
  return null;
}

export function userAgent(request: Request): string | null {
  return request.headers.get("user-agent");
}
