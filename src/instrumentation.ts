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
 * Node only. There is no edge config, so nothing Sentry is loaded into the
 * middleware bundle: instrumenting it cost 68 kB on a bundle that runs on every
 * single request, to watch a cookie presence check that has no meaningful way
 * to fail. If the middleware ever starts making decisions worth reporting on,
 * add a sentry.edge.config.ts and a branch here for NEXT_RUNTIME "edge".
 *
 * The import stays dynamic and inside the runtime check so the Node SDK is
 * never pulled into a bundle that cannot use it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
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
