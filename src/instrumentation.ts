/**
 * Next's server side instrumentation hook.
 *
 * register() runs once per runtime before anything else, which is the only
 * moment early enough to catch an error thrown while a module is still loading.
 *
 * This file exists because the Sentry build plugin is deliberately not
 * installed. With withSentryConfig the sentry.*.config.ts files are wired up by
 * the bundler; without it they are ordinary modules nothing imports, so the
 * import below is what actually switches Sentry on.
 *
 * The import is dynamic and inside the runtime check so the Node SDK is never
 * pulled into the edge bundle, or the other way round.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

/**
 * Errors thrown inside a route handler or a server component.
 *
 * Next catches these before they reach any Sentry handler of its own, so
 * without this hook the ones that matter most here, a pledge failing to record,
 * would never be reported at all. Re-exported straight from the SDK, which
 * routes the event through the same beforeSend as everything else.
 */
export { captureRequestError as onRequestError } from "@sentry/nextjs";
