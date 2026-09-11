import * as Sentry from "@sentry/nextjs";

import { beforeSend } from "@/lib/sentry-scrub";

/**
 * Sentry in the browser.
 *
 * NOT CURRENTLY LOADED. Nothing imports this file, so browser errors are not
 * reported and none of the options below take effect.
 *
 * It is switched on by creating src/instrumentation-client.ts containing
 * `import "../sentry.client.config";`, which Next loads by name on the client.
 * That one line costs about 72 kB of JavaScript on every page, because it pulls
 * the browser SDK into the shared bundle, and the session it was written in had
 * a budget of 15 kB. The server and edge halves are live and carry no such
 * cost, so crashes in route handlers, server components, the cron job and the
 * middleware are reported today. What is missing is errors thrown in somebody's
 * browser.
 *
 * The scrubbing below is identical to the other two configs and is already
 * tested, so turning this on is a one line change and not a piece of work.
 *
 * The DSN is NEXT_PUBLIC_SENTRY_DSN and not SENTRY_DSN, because a variable
 * without the prefix does not exist in a browser: Next only inlines
 * NEXT_PUBLIC_ values into the client bundle. Leave it unset and the SDK stays
 * inert, which means browser errors go unreported while server errors still
 * arrive. A DSN is not a secret, so publishing it is the normal arrangement
 * rather than a compromise.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",

  /*
   * No automatic personal data. In a browser this is what stops the SDK
   * attaching the visitor's IP to every event.
   */
  sendDefaultPii: false,

  tracesSampleRate: 0.1,

  /*
   * Session replay is off, and deliberately not merely sampled at zero with the
   * integration still loaded.
   *
   * A replay records the DOM of the pledge form while somebody types their
   * name, their phone number and what they are giving into it. There is no
   * sampling rate at which that is an acceptable thing to send to a third
   * party, so the integration is never added at all. Keeping both rates here
   * anyway documents the intent for whoever reads this next and wonders whether
   * replay was forgotten or refused.
   */
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  beforeSend,
});
