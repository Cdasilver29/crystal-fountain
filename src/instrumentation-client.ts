/**
 * Runs in the browser before the app hydrates.
 *
 * Turns off zod's compiled validators. To decide whether it may compile, zod
 * probes with Function(""), which the Content Security Policy rightly reports
 * as an eval on every page with a form. The probe's failure is caught and zod
 * falls back to the same validation without compiling, so nothing is lost but
 * a little speed on forms of a dozen fields, and the reports stay quiet enough
 * to read.
 *
 * Set on the global zod reads its configuration from, rather than through
 * z.config(), so this file imports nothing and adds nothing to pages without a
 * form. It has to run before any schema is built, which is why it lives here.
 */
const holder = globalThis as { __zod_globalConfig?: { jitless?: boolean } };
holder.__zod_globalConfig ??= {};
holder.__zod_globalConfig.jitless = true;
