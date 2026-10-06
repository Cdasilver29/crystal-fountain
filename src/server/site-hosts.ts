/**
 * The addresses this site is served from, and the one place they are listed.
 *
 * Two checks read this: the Turnstile hostname check, which refuses a token
 * solved on somebody else's copy of a form, and the origin check, which
 * refuses a write sent from somebody else's page. They take the same list from
 * the same function so they can never disagree about where the site lives.
 *
 * Plain data and functions, no environment. src/lib/site-hosts.ts reads the
 * environment and passes it in.
 */

/**
 * Every public address of the production site.
 *
 * The church subdomain is the public origin, but members still arrive on the
 * Vercel address from links shared before it existed, and the forms there
 * must work too. Exact names only: a lookalike such as
 * crystal-fountain.vercel.app.example.com is a different host and is refused.
 */
export const SITE_HOSTNAMES = [
  "development.newlifesdanairobi.org",
  "crystal-fountain.vercel.app",
] as const;

/** A laptop running the app, which is never a production deployment. */
const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1"] as const;

export type Deployment = {
  /** VERCEL_ENV: production, preview, or unset on a laptop. */
  vercelEnv: string | undefined;
  /** VERCEL_URL, the unique address of this deployment, without a scheme. */
  vercelUrl?: string | undefined;
  /** VERCEL_BRANCH_URL, the stable address of a preview's git branch. */
  vercelBranchUrl?: string | undefined;
};

function hostOf(value: string | undefined, assumeScheme: boolean): string | null {
  if (!value) return null;
  try {
    return new URL(assumeScheme ? `https://${value}` : value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The hostnames the site answers on.
 *
 * The addresses above, plus the configured public origin in case it ever
 * moves before this list does.
 *
 * Given a deployment that is not production, also the laptop's own loopback
 * names and the preview's Vercel addresses, so a local run and a preview can
 * submit their own forms. Production never gets these: a production build
 * answering a write from localhost would be answering somebody's laptop.
 * Without a deployment, the strict list, which is what the tests pin.
 */
export function siteHostnames(
  siteUrl: string | undefined,
  deployment?: Deployment,
): string[] {
  const hosts = new Set<string>(SITE_HOSTNAMES);
  const configured = hostOf(siteUrl, false);
  if (configured) hosts.add(configured);

  if (deployment && deployment.vercelEnv !== "production") {
    for (const host of LOOPBACK_HOSTNAMES) hosts.add(host);
    for (const value of [deployment.vercelUrl, deployment.vercelBranchUrl]) {
      const host = hostOf(value, true);
      if (host) hosts.add(host);
    }
  }

  return [...hosts];
}

/** Why a write was refused as cross site. For the response code and the log. */
export type CrossSiteReason = "foreign_origin" | "cross_site_fetch";

/**
 * Whether a state changing request came from somebody else's page.
 *
 * Two signals, either of which refuses:
 *
 * - Sec-Fetch-Site: cross-site. The browser's own statement that the page
 *   that sent this is on another site. Same-site is not refused here, because
 *   the main church site on the parent domain is same-site; its Origin is
 *   still not on the list, so the second check refuses it.
 * - An Origin header that is present and not one of ours, including the
 *   literal "null" a sandboxed frame or a privacy redirect sends. Plain http
 *   is refused except on loopback.
 *
 * A request with neither header passes. That is a script or a server, not a
 * browser, and a browser cannot be made to leave both off a cross site POST,
 * which is the attack this stops. Authentication is a separate question every
 * admin route still answers for itself.
 */
export function crossSiteReason(
  headers: Headers,
  allowedHostnames: readonly string[],
): CrossSiteReason | null {
  if (headers.get("sec-fetch-site")?.trim().toLowerCase() === "cross-site") {
    return "cross_site_fetch";
  }

  const origin = headers.get("origin");
  if (origin === null) return null;

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return "foreign_origin";
  }

  const host = url.hostname.toLowerCase();
  if (!allowedHostnames.includes(host)) return "foreign_origin";

  const loopback = (LOOPBACK_HOSTNAMES as readonly string[]).includes(host);
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    return "foreign_origin";
  }

  return null;
}
