import { config } from "dotenv";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Sentry PII scrubbing.
 *
 * Two halves, because either alone would prove the wrong thing.
 *
 * The first runs a representative event through the scrubber directly and
 * checks every rule. The second initialises the real SDK with the real options
 * and a transport that captures instead of sending, throws from something
 * shaped like a route handler, and inspects the envelope that would have gone
 * to Sentry. A scrubber that works but is never wired in is worth nothing, and
 * a wiring test that does not read the payload cannot see a leak.
 *
 * Nothing here touches the network or the database.
 *
 * Usage: pnpm db:verify:sentry
 */

const failures: string[] = [];
function check(label: string, ok: boolean, detail?: string) {
  if (!ok) failures.push(label);
  console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
}
function heading(text: string) {
  console.log(`\n== ${text} ==`);
}

/** The details a leak would expose, each distinctive enough to grep for. */
const PHONE = "+254712345678";
const LOCAL_PHONE = "0712345678";
const EMAIL = "grace.wanjiru@example.test";
const SURNAME = "Wanjiru";
const COOKIE = "better-auth.session_token=supersecretsessionvalue";
const BEARER = "Bearer sk-live-not-a-real-token";
const IP = "197.248.10.44";

async function main() {
  const { scrubEvent, beforeSend, REDACTED } = await import(
    "@/lib/sentry-scrub"
  );

  // ---------------------------------------------------------------------------
  heading("1. a route handler error, scrubbed");

  /*
   * Shaped the way Sentry builds an event for a throw inside POST /api/pledges:
   * the request it was handling, the body that was posted, the breadcrumb trail
   * and whatever the application attached as context.
   */
  const event = {
    event_id: "abc123",
    level: "error",
    request: {
      url: "https://pledge.newlifesdanairobi.org/api/pledges",
      method: "POST",
      headers: {
        "content-type": "application/json",
        Cookie: COOKIE,
        Authorization: BEARER,
        "user-agent": "Mozilla/5.0",
      },
      cookies: { "better-auth.session_token": "supersecretsessionvalue" },
      data: JSON.stringify({
        fullName: `Grace ${SURNAME}`,
        phone: PHONE,
        email: EMAIL,
        amountKes: 50000,
        turnstileToken: "0.abcdef",
        recordConsent: true,
      }),
    },
    user: { id: "pledger-1", ip_address: IP, email: EMAIL },
    contexts: {
      pledge: {
        reference: "CF26-000124",
        phone_e164: PHONE,
        display_name: `Grace ${SURNAME}`,
        amount_minor: "5000000",
      },
    },
    extra: {
      payment: {
        payer_name: "Grace W",
        payer_msisdn: PHONE,
        payer_phone: LOCAL_PHONE,
        external_ref: "QGH7X8K9LM",
      },
    },
    breadcrumbs: [
      {
        category: "query",
        message: "select from pledgers",
        data: { phone: PHONE, full_name: `Grace ${SURNAME}` },
      },
    ],
    tags: { email: EMAIL, route: "/api/pledges" },
  } as never;

  const scrubbed = scrubEvent(structuredClone(event)) as unknown as Record<
    string,
    never
  >;
  const asText = JSON.stringify(scrubbed, null, 2);
  console.log(asText);

  heading("2. nothing identifying survived");

  const mustNotAppear: [string, string][] = [
    ["the E.164 phone number", PHONE],
    ["the local phone number", LOCAL_PHONE],
    ["the email address", EMAIL],
    ["the surname", SURNAME],
    ["the session cookie", "supersecretsessionvalue"],
    ["the bearer token", "sk-live-not-a-real-token"],
    ["the IP address", IP],
  ];
  for (const [label, secret] of mustNotAppear) {
    check(`${label} is gone`, !asText.includes(secret));
  }

  heading("3. each rule did what it says");

  const req = scrubbed.request as unknown as {
    headers: Record<string, string>;
    cookies?: unknown;
    data: Record<string, unknown>;
  };
  check("the cookie header is dropped", !("Cookie" in req.headers));
  check("the authorization header is dropped", !("Authorization" in req.headers));
  check(
    "the harmless headers are kept, so a report is still readable",
    req.headers["content-type"] === "application/json" &&
      req.headers["user-agent"] === "Mozilla/5.0",
  );
  check("the parsed cookie jar is dropped", req.cookies === undefined);

  check("body fullName is redacted", req.data.fullName === REDACTED);
  check("body phone is redacted", req.data.phone === REDACTED);
  check("body email is redacted", req.data.email === REDACTED);
  check(
    "body turnstileToken is redacted, since it contains token",
    req.data.turnstileToken === REDACTED,
  );
  check(
    "the amount is kept, because it is not personal and it is what you debug with",
    req.data.amountKes === 50000,
  );
  check("the consent flag is kept", req.data.recordConsent === true);

  const user = scrubbed.user as unknown as Record<string, unknown>;
  check("the user IP is gone", user.ip_address === undefined);
  check("the user email is redacted", user.email === REDACTED);
  check("the opaque user id is kept", user.id === "pledger-1");

  const ctx = (scrubbed.contexts as unknown as Record<string, Record<string, unknown>>)
    .pledge;
  check("context phone_e164 is redacted", ctx.phone_e164 === REDACTED);
  check("context display_name is redacted", ctx.display_name === REDACTED);
  check(
    "the pledge reference is kept, since it identifies a record and not a person",
    ctx.reference === "CF26-000124",
  );

  const extra = (scrubbed.extra as unknown as Record<string, Record<string, unknown>>)
    .payment;
  check("payer_name is redacted", extra.payer_name === REDACTED);
  check("payer_msisdn is redacted", extra.payer_msisdn === REDACTED);
  check("payer_phone is redacted", extra.payer_phone === REDACTED);
  check("the M-Pesa receipt code is kept", extra.external_ref === "QGH7X8K9LM");

  const crumb = (scrubbed.breadcrumbs as unknown as {
    data: Record<string, unknown>;
  }[])[0];
  check("a breadcrumb is scrubbed too", crumb.data.phone === REDACTED);
  check("and its full_name", crumb.data.full_name === REDACTED);

  const tags = scrubbed.tags as unknown as Record<string, string>;
  check("a tag is scrubbed", tags.email === REDACTED);
  check("the route tag is kept", tags.route === "/api/pledges");

  heading("4. key spellings and awkward shapes");

  const spellings = scrubEvent({
    extra: {
      camel: { phoneE164: PHONE, fullName: "X", displayName: "Y", payerMsisdn: PHONE },
      snake: { phone_e164: PHONE, full_name: "X" },
      shouty: { PHONE: PHONE, Email: EMAIL },
      nested: { deep: { list: [{ phone: PHONE }, { email: EMAIL }] } },
    },
  } as never);
  const spellingText = JSON.stringify(spellings);
  check(
    "camelCase, snake_case and upper case all match the same rule",
    !spellingText.includes(PHONE) && !spellingText.includes(EMAIL),
    spellingText,
  );

  const unparseable = scrubEvent({
    request: { data: `name=Grace ${SURNAME}&phone=${PHONE}` },
  } as never) as unknown as { request: { data: unknown } };
  check(
    "a body that is not JSON is dropped whole rather than searched",
    unparseable.request.data === REDACTED,
    String(unparseable.request.data),
  );

  const empty = scrubEvent({} as never);
  check("an event with no request and no user does not throw", empty !== null);

  // ---------------------------------------------------------------------------
  heading("5. the real SDK, with the real options");

  /*
   * tsx compiles this file to CJS, so the whole namespace arrives under
   * .default rather than as named exports. This is a quirk of running the
   * script, not of the SDK: the application imports it normally.
   */
  const imported = await import("@sentry/nextjs");
  const Sentry = ((imported as unknown as { default?: typeof imported })
    .default ?? imported) as typeof imported;

  /*
   * A transport that captures instead of sending. This is the only honest way
   * to see what would have left the process: the event goes through the SDK's
   * whole pipeline, beforeSend included, and is then handed to us rather than
   * to Sentry.
   */
  const sent: string[] = [];
  const capturingTransport = () => ({
    send: async (envelope: unknown) => {
      sent.push(JSON.stringify(envelope));
      return {};
    },
    flush: async () => true,
  });

  const client = new Sentry.NodeClient({
    dsn: "https://examplePublicKey@o0.ingest.sentry.io/0",
    environment: "verification",
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    beforeSend,
    transport: capturingTransport as never,
    stackParser: Sentry.defaultStackParser,
    integrations: [],
  });

  const scope = new Sentry.Scope();
  scope.setClient(client);
  scope.setUser({ id: "pledger-2", ip_address: IP, email: EMAIL });
  scope.setContext("pledge", { phone_e164: PHONE, display_name: `Grace ${SURNAME}` });
  scope.setExtra("body", { phone: PHONE, email: EMAIL, fullName: `Grace ${SURNAME}` });

  // Something shaped like a route handler falling over mid pledge.
  function recordPledge(): never {
    throw new Error("could not record pledge");
  }

  try {
    recordPledge();
  } catch (error) {
    scope.captureException(error);
  }

  await client.flush(2000);

  check("the SDK produced exactly one envelope", sent.length === 1, `${sent.length}`);

  const envelope = sent.join("");
  console.log(`\nthe envelope that would have gone to Sentry:\n${envelope}\n`);

  check("the envelope carries the error", envelope.includes("could not record pledge"));
  for (const [label, secret] of mustNotAppear) {
    if (secret === COOKIE || secret === BEARER) continue;
    check(`the envelope does not carry ${label}`, !envelope.includes(secret));
  }
  check(
    "and it is redacted rather than merely absent",
    envelope.includes(REDACTED),
  );

  heading("result");
  if (failures.length > 0) {
    console.error(`${failures.length} check(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("all checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
