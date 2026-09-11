import * as Sentry from "@sentry/nextjs";

import { beforeSend } from "@/lib/sentry-scrub";

/**
 * Sentry on the edge runtime, which here means src/middleware.ts.
 *
 * Separate from the server config because the edge runtime is a different
 * process with a different global scope, so it needs its own init. The options
 * are deliberately identical: the middleware sees the session cookie on every
 * admin request, so it is the last place that should scrub differently.
 *
 * Loaded from src/instrumentation.ts when NEXT_RUNTIME is "edge".
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN,

  environment: process.env.VERCEL_ENV ?? "development",

  sendDefaultPii: false,

  tracesSampleRate: 0.1,

  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  beforeSend,
});
