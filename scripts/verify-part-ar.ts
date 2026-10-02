import { writeFileSync } from "node:fs";

import { config } from "dotenv";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Session 1E of the security hardening: the full reference is the owner's.
 *
 * The pledge pages show the whole reference, the copy button and payment
 * instructions quoting it only to the browser holding the ownership cookie for
 * that pledge. Everybody else sees it masked to its last three digits, general
 * instructions, and an invitation to make their own pledge. Neither view may
 * sit in a shared cache. The share card and share message never carry the
 * whole reference, nor do the title and description. The confirmation email
 * still does, because only the owner reaches it.
 *
 * Needs the server started with OWNER_COOKIE_SECRET set.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:owner-view
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const PHONE = "0799900801";
const IP = "198.51.100.160";

function heading(text: string) {
  console.log(`\n== ${text} ==`);
}

async function main() {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const { maskReference } = await import("@/lib/format");
  const { normalizeKenyanPhone } = await import("@/server/contracts/phone");
  const { renderPledgeConfirmationEmail } = await import("@/server/email/pledge-confirmation");
  const { builtInPaymentDetails } = await import("@/lib/payment-details");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  };

  const phone = normalizeKenyanPhone(PHONE)!;

  const cleanup = async () => {
    await db.execute(sql`
      delete from pledges
      where pledger_id in (select id from pledgers where phone_e164 = ${phone})
    `);
    await db.execute(sql`delete from pledgers where phone_e164 = ${phone}`);
    await db.execute(sql`delete from pledge_submissions where ip = ${IP}::inet`);
  };

  await cleanup();

  const page = async (path: string, cookie?: string) => {
    const response = await fetch(`${BASE}${path}`, {
      headers: cookie ? { cookie } : {},
      cache: "no-store",
    });
    return {
      status: response.status,
      cacheControl: response.headers.get("cache-control") ?? "",
      html: (await response.text()).replace(/<!-- -->/g, ""),
    };
  };

  const head = (html: string) => {
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
    const metas = [...html.matchAll(/<meta[^>]+(?:name|property)="(?:description|og:description|og:title|og:image:alt|twitter:description|twitter:title)"[^>]*>/g)]
      .map((m) => m[0])
      .join("\n");
    return `${title}\n${metas}`;
  };

  try {
    // A pledge made over HTTP, so this run holds a real ownership cookie.
    const made = await fetch(`${BASE}/api/pledges`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": IP },
      body: JSON.stringify({
        fullName: "Owner Viewtester",
        phone,
        intent: "one_off",
        amountKes: 400_000,
        recordConsent: true,
        contactConsent: false,
        displayConsent: false,
        turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
      }),
    });
    const body = (await made.json()) as { reference: string; publicToken: string };
    const cookie = made.headers.getSetCookie().find((c) => c.startsWith("cf_owner="))?.split(";")[0];
    const { reference, publicToken } = body;
    const masked = maskReference(reference);
    check("the pledge is recorded and the browser holds its cookie", made.status === 201 && Boolean(cookie));
    console.log(`reference ${reference} masks to ${masked}`);

    for (const path of [`/pledge/confirmed/${publicToken}`, `/p/${publicToken}`]) {
      heading(`${path.startsWith("/p/") ? "/p/<token>" : "/pledge/confirmed/<token>"}`);

      const owner = await page(path, cookie);
      check("the owner sees the whole reference", owner.html.includes(reference));
      check("with the copy button and the save block", owner.html.includes("Copy reference") && owner.html.includes("Save your pledge reference"));
      check("payment instructions quoting it", owner.html.includes(`Account Number: ${reference}`));
      check("and the way to increase it", owner.html.includes("Increase my pledge"));

      const visitor = await page(path);
      check("a visitor sees it masked", visitor.html.includes(masked));
      check("and the whole reference is nowhere in the page", !visitor.html.includes(reference));
      check("no copy button and no save block", !visitor.html.includes("Copy reference") && !visitor.html.includes("Save your pledge reference"));
      check("general payment instructions", visitor.html.includes("If you have recorded a pledge, use your CF26 reference"));
      check("and an invitation to make their own instead", visitor.html.includes("Make your own pledge") && !visitor.html.includes("Increase my pledge"));

      for (const [who, r] of [["owner", owner], ["visitor", visitor]] as const) {
        check(
          `never in a shared cache (${who})`,
          /private/.test(r.cacheControl) && /no-store/.test(r.cacheControl) && !/s-maxage|public/.test(r.cacheControl),
          r.cacheControl,
        );
        check(`title and description carry no whole reference (${who})`, !head(r.html).includes(reference));
        check(`the share message carries no reference (${who})`, r.html.includes("Make yours at") && !r.html.includes("Reference: "));
      }
    }

    heading("the greeting on the way back to the form");
    const greetOwner = await page(`/pledge?add=${publicToken}`, cookie);
    check("the owner is greeted with what they pledged", greetOwner.html.includes("You have an existing pledge of") && greetOwner.html.includes(reference));
    const greetVisitor = await page(`/pledge?add=${publicToken}`);
    check("a visitor is greeted with nothing", !greetVisitor.html.includes("You have an existing pledge of") && !greetVisitor.html.includes(reference));

    heading("the share card");
    const card = await fetch(`${BASE}/api/pledges/${publicToken}/card.png`);
    check("renders", card.status === 200 && (card.headers.get("content-type") ?? "").includes("image/png"));
    if (process.env.VERIFY_CARD_OUT) {
      writeFileSync(process.env.VERIFY_CARD_OUT, Buffer.from(await card.arrayBuffer()));
      console.log(`card saved for inspection: ${process.env.VERIFY_CARD_OUT}`);
    }

    heading("where the whole reference still goes");
    const builtIn = builtInPaymentDetails();
    const email = renderPledgeConfirmationEmail({
      fullName: "Owner Viewtester",
      reference,
      publicToken,
      amountMinor: 40_000_000n,
      addedMinor: 40_000_000n,
      isAddition: false,
      installmentFrequency: null,
      details: {
        paybill: builtIn.mpesaPaybill,
        bankName: builtIn.bankName,
        bankAccount: builtIn.bankAccount,
      },
      siteUrl: BASE,
    });
    check("the confirmation email, which only the owner receives", email.text.includes(reference));
  } finally {
    heading("cleanup");
    await cleanup();
  }

  heading("result");
  if (failures.length > 0) {
    console.error(`${failures.length} check(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("all checks passed");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
