import * as Sentry from "@sentry/nextjs";
import { revalidateTag } from "next/cache";
import { after } from "next/server";

import { db } from "@/db";
import {
  clientIp,
  problem,
  serviceProblem,
  userAgent,
  validationProblem,
} from "@/lib/api";
import { CAMPAIGN_SLUG, CAMPAIGN_TOTALS_TAG } from "@/lib/campaign";
import { resolvePaymentDetails } from "@/lib/payment-details";
import { env } from "@/env";
import { createPledgeInput, type CreatePledgeInput } from "@/server/contracts/pledges";
import * as campaign from "@/server/services/campaign";
import { sendPledgeConfirmation } from "@/server/services/email";
import * as pledges from "@/server/services/pledges";
import { turnstileBypassAllowed } from "@/server/services/turnstile";

export const dynamic = "force-dynamic";

/**
 * Sends the confirmation, without the pledger waiting for it.
 *
 * Scheduled with next/server's after(), which on Vercel is the runtime's
 * waitUntil: the response goes back the moment the pledge is committed and the
 * send runs after it, on the same invocation, so the work is not cut off when
 * the lambda is frozen. Off Vercel, where there is no waitUntil to hand it to,
 * Next runs the task once the response has been sent, which is the fire and
 * forget case and behaves the same from the pledger's side.
 *
 * Nothing in here can fail a pledge. The pledge is already committed and
 * already on their screen by the time this runs, so every path swallows its
 * error and reports it to Sentry instead. after() itself is called inside a try
 * for the same reason: it needs a request context, and a future runtime that
 * cannot give it one must not turn a recorded pledge into a 500.
 */
function sendConfirmation(args: {
  input: CreatePledgeInput;
  result: pledges.CreatePledgeResult;
  settings: campaign.CampaignSettings | null;
}) {
  // No address, no email. The form's email field is optional and most pledgers
  // leave it blank, so this is the ordinary case and not a failure.
  if (!args.input.email) return;

  const task = async () => {
    const outcome = await sendPledgeConfirmation(
      { apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM_EMAIL },
      {
        to: args.input.email,
        pledge: {
          fullName: args.input.fullName,
          reference: args.result.reference,
          publicToken: args.result.publicToken,
          amountMinor: args.result.amountMinor,
          addedMinor: args.result.addedMinor,
          isAddition: args.result.isAddition,
          /*
           * What they chose on this submission, which is also what the service
           * has just written to the pledge: a submission's frequency replaces
           * whatever was on the pledge before, and the instalment is derived
           * from the new cumulative total. So the plan quoted here is the plan
           * in the database.
           */
          installmentFrequency: args.input.installmentFrequency ?? null,
          // Database first, repo values as the fallback. The settings row was
          // already read at the top of this handler, so this costs no query.
          details: resolvePaymentDetails(args.settings),
          siteUrl: env.NEXT_PUBLIC_SITE_URL,
        },
      },
    );

    if (outcome.status === "failed") {
      /*
       * The reference identifies which pledge went unconfirmed without naming
       * anybody. No address, no name and no amount: Sentry is scrubbed of
       * personal detail by src/lib/sentry-scrub.ts and this must not be the one
       * place that puts it back.
       */
      Sentry.captureException(outcome.error, {
        tags: { area: "pledge_confirmation_email" },
        extra: { reference: args.result.reference },
      });
    }
  };

  try {
    // A callback rather than a promise, so the work starts once the response
    // has gone rather than racing it. Passing task() here would call it now.
    after(() => task().catch(() => {}));
  } catch {
    // No request context to schedule against. Run it detached instead, so the
    // email is still attempted and a failure still goes nowhere near the
    // response.
    void task().catch(() => {});
  }
}

/**
 * POST /api/pledges
 *
 * Thin adapter: parse, call the service, format. Every field is validated here
 * with the same schema the form uses. Client validation is convenience only.
 *
 * A submission from a phone number that already has a live pledge adds to that
 * pledge rather than creating another one, so the reference and the public
 * token that come back are the ones the pledger already has. 200 rather than
 * 201 says so: nothing was created. The isAddition flag is what the form reads
 * to decide between telling somebody their pledge is recorded and telling them
 * it has been updated.
 *
 * This is the only place that knows where the Turnstile keys and the approval
 * limit come from. The service takes them as data, so the policy is testable
 * without an environment and stays portable if the API is split out later.
 */
export async function POST(request: Request) {
  /*
   * The settings, read per request rather than from the environment alone.
   *
   * is_public closes the form, and the auto approve limit is something the
   * treasurer can move on a Sabbath morning without a deploy. The environment
   * variable stays the default a fresh installation starts from, and the
   * database wins when it has an opinion.
   */
  const settings = await campaign
    .getSettings(db, { campaignSlug: CAMPAIGN_SLUG })
    .catch(() => null);

  if (settings && !settings.isPublic) {
    return problem(
      403,
      "pledging_closed",
      "Pledging is not open at the moment. Please try again later, or speak to the treasurer.",
    );
  }

  const limitKes = settings?.autoApproveLimitMinor
    ? Number(settings.autoApproveLimitMinor / 100n)
    : env.PLEDGE_AUTO_APPROVE_LIMIT_KES;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return problem(400, "invalid_json", "That request body was not valid JSON.");
  }

  const parsed = createPledgeInput.safeParse(body);

  if (!parsed.success) {
    return validationProblem(parsed.error);
  }

  try {
    const result = await pledges.create(db, {
      input: parsed.data,
      campaignSlug: CAMPAIGN_SLUG,
      channel: "web",
      request: { ip: clientIp(request), userAgent: userAgent(request) },
      security: {
        token: parsed.data.turnstileToken,
        keys: {
          siteKey: env.TURNSTILE_SITE_KEY,
          secretKey: env.TURNSTILE_SECRET_KEY,
        },
        bypassAllowed: turnstileBypassAllowed(process.env.NODE_ENV),
        autoApproveLimitKes: limitKes,
      },
    });

    /*
     * An auto approved pledge counts toward the public total the moment it is
     * recorded, so the cached totals are stale as soon as this returns and the
     * tracker would otherwise show the old figure for up to its max age. A
     * pledge left pending changes nothing anybody can see, and approval
     * revalidates for itself.
     */
    if (result.autoApproved) {
      revalidateTag(CAMPAIGN_TOTALS_TAG);
    }

    /*
     * The confirmation email, in the response path rather than in the service.
     *
     * Deliberately here and not inside pledges.create: the service runs the
     * whole pledge in one transaction, and an email is not something that can
     * be rolled back. Sending from inside it would mean either holding the
     * transaction open across a call to somebody else's API, or sending a
     * confirmation for a pledge that then failed to commit. This runs after the
     * commit, when there is a reference worth confirming.
     */
    sendConfirmation({ input: parsed.data, result, settings });

    return Response.json(
      {
        reference: result.reference,
        publicToken: result.publicToken,
        // Amounts always cross the wire as integer minor units with an
        // explicit currency, per PLAN.md section 13.
        amountMinor: result.amountMinor.toString(),
        addedMinor: result.addedMinor.toString(),
        previousAmountMinor: result.previousAmountMinor?.toString() ?? null,
        isAddition: result.isAddition,
        currency: result.currency,
        status: result.status,
      },
      { status: result.isAddition ? 200 : 201 },
    );
  } catch (error) {
    return serviceProblem(error);
  }
}
