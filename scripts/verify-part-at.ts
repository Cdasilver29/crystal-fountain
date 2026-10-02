import { config } from "dotenv";
import { createServer } from "node:http";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Session 2A of the security hardening: Turnstile on every public form that
 * looks up or changes a pledge, with its own action name, on our own hostname.
 *
 * Cloudflare's test secrets answer with no action and example.com, so they
 * cannot show a token being refused for the wrong form or the wrong site. This
 * suite runs its own stand in siteverify instead, which answers with whatever
 * claims the token spells out: "stub|<action>|<hostname>" passes with those
 * claims, "stub-fail" is refused the way Cloudflare refuses a bad token.
 *
 * The server must be started pointed at it, with keys that are not
 * Cloudflare's test pair:
 *
 *   $env:TURNSTILE_SITE_KEY = "stub-site"
 *   $env:TURNSTILE_SECRET_KEY = "stub-secret"
 *   $env:TURNSTILE_SITEVERIFY_URL = "http://127.0.0.1:3999/siteverify"
 *   pnpm start
 *
 * Then pnpm db:verify:bot-check. The stand in is honoured only off the
 * production deployment; the unit tests in turnstile.test.ts show it refused
 * there.
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const STUB_PORT = Number(process.env.VERIFY_SITEVERIFY_PORT ?? 3999);
const IP = "198.51.100.180";
const PHONES = { lookup: "0799900911", pledge: "0799900912" };

function heading(text: string) {
  console.log(`\n== ${text} ==`);
}

/** Answers siteverify with the claims the token names. */
function startStub() {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", async () => {
      // The service posts multipart form data. Let Request parse it.
      const form = await new Request("http://stub", {
        method: "POST",
        headers: { "content-type": req.headers["content-type"] ?? "" },
        body: Buffer.concat(chunks),
      }).formData();
      const token = String(form.get("response") ?? "");
      seen.push(token);

      const [kind, action, hostname] = token.split("|");
      const payload =
        kind === "stub"
          ? { success: true, "error-codes": [], action, hostname }
          : { success: false, "error-codes": ["invalid-input-response"] };

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    });
  });
  return new Promise<{ seen: string[]; close: () => void }>((resolve) =>
    server.listen(STUB_PORT, "127.0.0.1", () =>
      resolve({ seen, close: () => server.close() }),
    ),
  );
}

async function main() {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const { CAMPAIGN_SLUG } = await import("@/lib/campaign");
  const pledges = await import("@/server/services/pledges");
  const { normalizeKenyanPhone } = await import("@/server/contracts/phone");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  };

  const site = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "").hostname;
  const token = (action: string, hostname = site) =>
    `stub|${action}|${hostname}`;

  const e164 = {
    lookup: normalizeKenyanPhone(PHONES.lookup)!,
    pledge: normalizeKenyanPhone(PHONES.pledge)!,
  };
  const both = sql.join([sql`${e164.lookup}`, sql`${e164.pledge}`], sql`, `);

  const cleanup = async () => {
    await db.execute(sql`
      delete from pledge_change_requests where pledge_id in (
        select p.id from pledges p join pledgers g on g.id = p.pledger_id
        where g.phone_e164 in (${both})
      )
    `);
    await db.execute(sql`
      delete from pledges where pledger_id in (
        select id from pledgers where phone_e164 in (${both})
      )
    `);
    await db.execute(sql`delete from pledgers where phone_e164 in (${both})`);
    await db.execute(sql`delete from pledge_lookups where ip = ${IP}::inet`);
    await db.execute(sql`delete from pledge_submissions where ip = ${IP}::inet`);
  };

  await cleanup();
  const stub = await startStub();

  try {
    // A published pledge to look up, ask about and withdraw from.
    const made = await pledges.create(db, {
      input: {
        fullName: "Bot Check Fixture",
        phone: e164.lookup,
        intent: "one_off" as const,
        amountKes: 1_000,
        recordConsent: true as const,
        contactConsent: false,
        displayConsent: true,
      },
      campaignSlug: CAMPAIGN_SLUG,
    });
    await pledges.approve(db, { pledgeId: made.pledgeId, adminId: null });

    const call = async (
      method: string,
      path: string,
      body: Record<string, unknown>,
    ) => {
      const response = await fetch(`${BASE}${path}`, {
        method,
        headers: { "content-type": "application/json", "x-forwarded-for": IP },
        body: JSON.stringify(body),
      });
      return {
        status: response.status,
        body: (await response.json().catch(() => null)) as Record<
          string,
          unknown
        > | null,
      };
    };

    const counts = async () => {
      const row = await db.execute(sql`
        select
          (select count(*)::int from pledge_lookups where ip = ${IP}::inet) as lookups,
          (select count(*)::int from pledge_change_requests where pledge_id = ${made.pledgeId}) as requests,
          (select display_consent from pledgers where phone_e164 = ${e164.lookup}) as listed,
          (select count(*)::int from pledges p join pledgers g on g.id = p.pledger_id
             where g.phone_e164 = ${e164.pledge}) as new_pledges
      `);
      return row.rows[0] as {
        lookups: number;
        requests: number;
        listed: boolean;
        new_pledges: number;
      };
    };

    const pair = { reference: made.reference, phone: PHONES.lookup };
    const forms = [
      {
        name: "the /redeem lookup",
        action: "redeem_lookup",
        method: "POST",
        path: "/api/redeem/lookup",
        body: pair,
        ok: (r: { status: number; body: Record<string, unknown> | null }) =>
          r.status === 200 && Boolean(r.body?.pledge),
      },
      {
        name: "a change request",
        action: "change_request",
        method: "POST",
        path: "/api/redeem/change-requests",
        body: {
          kind: "change_plan",
          reference: made.reference,
          contactPhoneE164: PHONES.lookup,
          reason: "Moving to monthly payments from next month.",
          requestedFrequency: "monthly",
        },
        ok: (r: { status: number }) => r.status === 201,
      },
      {
        name: "the consent withdrawal",
        action: "withdraw_consent",
        method: "DELETE",
        path: "/api/redeem/display-consent",
        body: pair,
        ok: (r: { status: number; body: Record<string, unknown> | null }) =>
          r.status === 200 && r.body?.changed === true,
      },
      {
        name: "the pledge form",
        action: "pledge",
        method: "POST",
        path: "/api/pledges",
        body: {
          fullName: "Bot Check Pledger",
          phone: PHONES.pledge,
          intent: "one_off",
          amountKes: 1_000,
          recordConsent: true,
          contactConsent: false,
          displayConsent: false,
        },
        ok: (r: { status: number }) => r.status === 201,
      },
    ];

    heading("0. the server is asking the stand in");
    const probe = await call("POST", "/api/redeem/lookup", {
      ...pair,
      turnstileToken: "stub-fail",
    });
    check(
      "a token the stand in refuses is refused",
      probe.status === 422 && probe.body?.code === "turnstile_failed",
      `${probe.status} ${probe.body?.code}`,
    );
    check(
      "and the stand in saw it, so this server is pointed at it",
      stub.seen.includes("stub-fail"),
    );

    const before = await counts();

    for (const [i, form] of forms.entries()) {
      heading(`${i + 1}. ${form.name}`);
      const other = forms[(i + 1) % forms.length]!.action;

      const none = await call(form.method, form.path, form.body);
      check(
        "no token is refused",
        none.status === 422 && none.body?.code === "turnstile_failed",
        `${none.status} ${none.body?.code}`,
      );

      const replayed = await call(form.method, form.path, {
        ...form.body,
        turnstileToken: token(other),
      });
      check(
        `a token solved on the ${other} form is refused`,
        replayed.status === 422 && replayed.body?.code === "turnstile_failed",
        `${replayed.status} ${replayed.body?.code}`,
      );

      const foreign = await call(form.method, form.path, {
        ...form.body,
        turnstileToken: token(form.action, "pledge-copy.example.com"),
      });
      check(
        "a token solved on a foreign hostname is refused",
        foreign.status === 422 && foreign.body?.code === "turnstile_failed",
        `${foreign.status} ${foreign.body?.code}`,
      );

      const lookalike = await call(form.method, form.path, {
        ...form.body,
        turnstileToken: token(form.action, `${site}.example.com`),
      });
      check(
        "a lookalike of our hostname is refused",
        lookalike.status === 422,
        `${lookalike.status}`,
      );

      if (i === 0) {
        const mid = await counts();
        check(
          "nothing was read or written by any refused submission so far",
          JSON.stringify(mid) === JSON.stringify(before),
          JSON.stringify(mid),
        );
      }

      const good = await call(form.method, form.path, {
        ...form.body,
        turnstileToken: token(form.action),
      });
      check(
        `this form's own token on ${site} goes through`,
        form.ok(good),
        `${good.status} ${good.body?.code ?? ""}`,
      );
    }

    heading("5. what landed");
    const after = await counts();
    console.table([{ before: JSON.stringify(before), after: JSON.stringify(after) }]);
    // The withdrawal counts against the lookup's per address limit, so each
    // good token leaves one row: the lookup's and the withdrawal's.
    check(
      "two lookup rows, one from each good token, none from a refused one",
      after.lookups - before.lookups === 2,
    );
    check("one change request recorded", after.requests - before.requests === 1);
    check("consent withdrawn once", before.listed === true && after.listed === false);
    check("one pledge recorded", after.new_pledges - before.new_pledges === 1);
  } finally {
    stub.close();
    await cleanup();
  }

  console.log(
    failures.length === 0
      ? "\nall checks passed"
      : `\n${failures.length} FAILED:\n  ${failures.join("\n  ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
