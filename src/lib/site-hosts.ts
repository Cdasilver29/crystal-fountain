import { env } from "@/env";
import { problem } from "@/lib/api";
import { crossSiteReason, siteHostnames } from "@/server/site-hosts";

/**
 * The site's hostnames for this deployment, read from the environment.
 *
 * The Turnstile check and the origin check both call this and nothing else,
 * so they always hold the same list.
 */
export function allowedSiteHostnames(): string[] {
  return siteHostnames(env.NEXT_PUBLIC_SITE_URL, {
    vercelEnv: process.env.VERCEL_ENV,
    vercelUrl: process.env.VERCEL_URL,
    vercelBranchUrl: process.env.VERCEL_BRANCH_URL,
  });
}

/**
 * The first thing every POST, PATCH and DELETE handler does.
 *
 * Returns the refusal to send, or null to carry on:
 *
 *   const crossSite = refuseCrossSite(request);
 *   if (crossSite) return crossSite;
 *
 * Better Auth's routes, the Google callback and the cron route are left to
 * their own checks and do not call this.
 */
export function refuseCrossSite(request: Request): Response | null {
  const reason = crossSiteReason(request.headers, allowedSiteHostnames());
  if (reason === null) return null;

  return problem(
    403,
    "cross_site_refused",
    "This request did not come from this site. Open the page on the site and try again.",
  );
}
