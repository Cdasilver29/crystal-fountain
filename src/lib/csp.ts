/**
 * The Content Security Policy, sent report-only.
 *
 * Built from what the site actually loads, page by page:
 *
 * - Scripts: our own chunks, Next's inline bootstrap and flight data, and the
 *   Turnstile loader on the pledge, lookup and change forms.
 * - Frames: the Turnstile challenge, and the YouTube player once somebody
 *   presses play. Nothing frames the site itself.
 * - Images: our own, the QR code and share card, and the YouTube poster
 *   frames, which come through the image optimiser and so are same origin
 *   too. data: for the small inline images Next and the icons use.
 * - Fonts: Geist and Fraunces are self hosted through next/font, so 'self'.
 * - Fetches: only our own API. The Sentry browser SDK is not loaded, so the
 *   browser never talks to Sentry except to post the reports below.
 * - Google sign in is a full page navigation to Google and back, started by
 *   script rather than a form post, so it needs neither form-action nor
 *   connect-src.
 *
 * zod's eval probe is switched off in src/instrumentation-client.ts, so
 * 'unsafe-eval' is needed only by the development server.
 *
 * Inline scripts are allowed with 'unsafe-inline'. Next writes its bootstrap
 * and the page's flight data as inline scripts. The two ways round that both
 * cost more than they buy today: nonces force every page to render on every
 * request, and the hash based option (experimental.sri) only works with
 * webpack, while this project must build with Turbopack, and even then it
 * covers the external chunks and not the inline flight data. See PLAN.md.
 *
 * Report-only for now: a violation is reported and nothing is blocked. Enforcing
 * it is a follow-up once a week of reports shows no legitimate violation.
 */

const TURNSTILE = "https://challenges.cloudflare.com";
const YOUTUBE_PLAYER = "https://www.youtube-nocookie.com";

/*
 * The Vercel toolbar, which Vercel injects into preview deployments only. It
 * loads its script, styles, fonts and a frame from vercel.live and holds a
 * websocket to Pusher for comments. Production never carries it, so these are
 * added for previews and nowhere else.
 */
const VERCEL_TOOLBAR = {
  "script-src": ["https://vercel.live"],
  "style-src": ["https://vercel.live"],
  "img-src": ["https://vercel.live", "https://vercel.com", "blob:"],
  "font-src": ["https://vercel.live", "https://assets.vercel.com"],
  "frame-src": ["https://vercel.live"],
  "connect-src": ["https://vercel.live", "wss://ws-us3.pusher.com"],
} as const;

/** The reporting group named by report-to and the Reporting-Endpoints header. */
export const CSP_REPORT_GROUP = "csp-endpoint";

/**
 * Sentry's security report endpoint for a DSN, or null if there is no usable
 * DSN.
 *
 * A DSN is https://<public key>@<host>/<project id>, and the endpoint is
 * https://<host>/api/<project id>/security/?sentry_key=<public key>. The key
 * here is the public half that every browser SDK ships, not a secret.
 */
export function sentryReportUri(
  dsn: string | undefined,
  environment: string | undefined,
): string | null {
  if (!dsn) return null;
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }
  const project = url.pathname.replace(/^\/+|\/+$/g, "");
  if (url.protocol !== "https:" || !url.username || !/^\d+$/.test(project)) {
    return null;
  }
  const endpoint = new URL(`https://${url.host}/api/${project}/security/`);
  endpoint.searchParams.set("sentry_key", url.username);
  if (environment) endpoint.searchParams.set("sentry_environment", environment);
  return endpoint.toString();
}

export type CspOptions = {
  /** VERCEL_ENV: production, preview, or unset on a laptop. */
  vercelEnv: string | undefined;
  /** NODE_ENV. Development needs eval for React's debugging aids. */
  nodeEnv: string | undefined;
  /** Where reports go, from sentryReportUri. Null sends none. */
  reportUri: string | null;
};

export function contentSecurityPolicy({
  vercelEnv,
  nodeEnv,
  reportUri,
}: CspOptions): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      TURNSTILE,
      ...(nodeEnv === "development" ? ["'unsafe-eval'"] : []),
    ],
    // React and Radix set style attributes, and next/font inlines its faces.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'"],
    "frame-src": [TURNSTILE, YOUTUBE_PLAYER],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };

  if (vercelEnv === "preview") {
    for (const [name, sources] of Object.entries(VERCEL_TOOLBAR)) {
      directives[name] = [...directives[name], ...sources];
    }
  }

  if (reportUri) {
    // report-uri for browsers without the Reporting API, report-to for the rest.
    directives["report-uri"] = [reportUri];
    directives["report-to"] = [CSP_REPORT_GROUP];
  }

  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");
}

/**
 * Every header the policy needs: the policy itself, and the two ways of
 * naming the reporting endpoint. Reporting-Endpoints is the current standard;
 * Report-To is what Chrome before 96 and some Android WebViews still read.
 */
export function cspHeaders(options: {
  vercelEnv: string | undefined;
  nodeEnv: string | undefined;
  sentryDsn: string | undefined;
}): { key: string; value: string }[] {
  const reportUri = sentryReportUri(
    options.sentryDsn,
    options.vercelEnv ?? "development",
  );
  const headers = [
    {
      key: "Content-Security-Policy-Report-Only",
      value: contentSecurityPolicy({ ...options, reportUri }),
    },
  ];
  if (reportUri) {
    headers.push(
      {
        key: "Reporting-Endpoints",
        value: `${CSP_REPORT_GROUP}="${reportUri}"`,
      },
      {
        key: "Report-To",
        value: JSON.stringify({
          group: CSP_REPORT_GROUP,
          max_age: 10886400,
          endpoints: [{ url: reportUri }],
          include_subdomains: false,
        }),
      },
    );
  }
  return headers;
}
