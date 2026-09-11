import * as Sentry from "@sentry/nextjs";

import { beforeSend } from "@/lib/sentry-scrub";

/**
 * Sentry on the Node server: route handlers, server components, the cron job.
 *
 * Loaded from src/instrumentation.ts, which Next calls once per runtime before
 * anything else runs.
 *
 * The DSN is read from process.env rather than through src/env.ts on purpose.
 * This file runs inside instrumentation, before any request, and reading the
 * env contract here would validate every other server key at a moment when Next
 * does not reliably have them. The contract still declares SENTRY_DSN, so a
 * mistyped value is caught the first time anything reads server env.
 *
 * An absent DSN leaves the SDK inert. That is the wanted behaviour on a laptop,
 * and it is why nothing here throws when the variable is missing.
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN,

  /*
   * Vercel sets this to production, preview or development. Without it we are
   * on somebody's machine, and saying so keeps laptop noise out of the
   * production issue list.
   */
  environment: process.env.VERCEL_ENV ?? "development",

  /*
   * No automatic personal data. This stops the SDK attaching the request IP,
   * cookies and headers of its own accord. beforeSend then removes what the
   * application itself may have attached, so neither half is relied on alone.
   */
  sendDefaultPii: false,

  // A tenth of transactions. Enough to see a slow route, far short of the
  // volume that makes a free Sentry project useless by the second week.
  tracesSampleRate: 0.1,

  /*
   * Session replay is off, and off in both directions.
   *
   * A replay records the DOM of a form that people type their name, their
   * number and their giving into, so an error triggered replay would capture
   * exactly the detail the rest of this file exists to remove. The rates are
   * zero on the server too, where they mean nothing, so that all three configs
   * read the same and nobody has to wonder whether one of them differs.
   */
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  beforeSend,
});
