import { Resend } from "resend";

import {
  renderChangeRequestAcknowledgement,
  renderChangeRequestDecision,
  type ChangeRequestAcknowledgementEmail,
  type ChangeRequestDecisionEmail,
} from "@/server/email/change-request";
import {
  renderPledgeConfirmationEmail,
  type PledgeConfirmationEmail,
  type RenderedEmail,
} from "@/server/email/pledge-confirmation";

/**
 * Sending email.
 *
 * A plain function taking its configuration as data, like every other service
 * here. It does not read the environment, does not touch Request or Response
 * and does not import from next. The route handler is the only place that knows
 * where the API key comes from.
 *
 * Nothing in this module ever throws. A confirmation email is a courtesy on top
 * of a pledge that is already committed to the database and already on the
 * pledger's screen, so there is no failure here worth turning into a failed
 * pledge. Every outcome comes back as a value the caller can log.
 */

export type EmailConfig = {
  /** The Resend API key, or undefined when email is not configured. */
  apiKey?: string;
  /** The From address, for example "Crystal Fountain <dev@example.org>". */
  from: string;
};

/**
 * What happened, as a value rather than an exception.
 *
 * "skipped" is not a failure: it is the answer for a pledger who left the email
 * field blank, and for an installation with no API key. Both are ordinary and
 * neither deserves a Sentry report, which is why they are a separate case from
 * "failed".
 */
export type SendResult =
  | { status: "sent"; id: string | null }
  | { status: "skipped"; reason: "no_recipient" | "not_configured" }
  | { status: "failed"; error: Error };

/**
 * The client, built once per key and then reused.
 *
 * Constructing a Resend instance per request would be wasteful on a warm lambda
 * and pointless, since the thing is a thin wrapper around fetch. Keyed by the
 * API key so a changed key is honoured rather than cached over.
 */
let cached: { apiKey: string; client: Resend } | null = null;

function client(apiKey: string): Resend {
  if (cached?.apiKey !== apiKey) {
    cached = { apiKey, client: new Resend(apiKey) };
  }
  return cached.client;
}

/** Whether email is switched on. An empty string counts as absent. */
export function isEmailConfigured(config: EmailConfig): boolean {
  return typeof config.apiKey === "string" && config.apiKey.trim() !== "";
}

/**
 * Sends the pledge confirmation.
 *
 * Renders the message, hands it to Resend and reports what happened. The
 * recipient is optional because the form's email field is: a pledger who left
 * it blank is skipped silently, which is the whole of the behaviour and not an
 * error path.
 */
export async function sendPledgeConfirmation(
  config: EmailConfig,
  args: { to: string | null | undefined; pledge: PledgeConfirmationEmail },
): Promise<SendResult> {
  const to = args.to?.trim();
  const apiKey = config.apiKey?.trim();

  if (!to) return { status: "skipped", reason: "no_recipient" };
  if (!apiKey) return { status: "skipped", reason: "not_configured" };

  const message = renderPledgeConfirmationEmail(args.pledge);

  try {
    const { data, error } = await client(apiKey).emails.send({
      from: config.from,
      to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      /*
       * A pledger who replies to their confirmation is answered by the
       * development office rather than by a noreply address nobody reads. The
       * From address is usually the same one, but it does not have to be: the
       * From has to sit on a domain Resend has verified and the reply address
       * does not.
       */
      replyTo: "churchdevelopment@newlifesdanairobi.org",
      /*
       * Lets a support conversation find the send in the Resend dashboard by
       * reference. The reference is not personal: it is a sequence number, and
       * it is already printed on the pledger's own confirmation page.
       */
      tags: [{ name: "kind", value: args.pledge.isAddition ? "addition" : "new" }],
    });

    if (error) {
      // Resend reports a refused send in the body rather than by throwing, so
      // this branch is the common failure and not the rare one.
      return {
        status: "failed",
        error: new Error(`Resend refused the send: ${error.message}`),
      };
    }

    return { status: "sent", id: data?.id ?? null };
  } catch (error) {
    // A network failure, a DNS failure, or Resend being down.
    return {
      status: "failed",
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/* ---------------------------------------------------------------------------
 * Change requests.
 * ------------------------------------------------------------------------- */

/**
 * Acknowledging a request, and telling somebody what was decided.
 *
 * The same shape as the confirmation above and for the same reasons: the
 * configuration arrives as data, nothing throws, and every outcome comes back
 * as a value the caller can log. A request is recorded in the database and on
 * the pledger's screen before either of these runs, so there is no failure
 * here worth turning into a failed request.
 *
 * The recipient is the address on the pledger record, which is optional and
 * which most pledgers leave blank. "skipped" with no_recipient is therefore
 * the ordinary case rather than an error, and the admin queue shows the
 * treasurer which requests those are so somebody can ring instead.
 */

async function deliver(
  config: EmailConfig,
  args: { to: string | null | undefined; message: RenderedEmail; tag: string },
): Promise<SendResult> {
  const to = args.to?.trim();
  const apiKey = config.apiKey?.trim();

  if (!to) return { status: "skipped", reason: "no_recipient" };
  if (!apiKey) return { status: "skipped", reason: "not_configured" };

  try {
    const { data, error } = await client(apiKey).emails.send({
      from: config.from,
      to,
      subject: args.message.subject,
      html: args.message.html,
      text: args.message.text,
      // Somebody who replies is answered by the development office rather
      // than by a noreply address nobody reads.
      replyTo: "churchdevelopment@newlifesdanairobi.org",
      tags: [{ name: "kind", value: args.tag }],
    });

    if (error) {
      return {
        status: "failed",
        error: new Error(`Resend refused the send: ${error.message}`),
      };
    }

    return { status: "sent", id: data?.id ?? null };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

export async function sendChangeRequestAcknowledgement(
  config: EmailConfig,
  args: { to: string | null | undefined; request: ChangeRequestAcknowledgementEmail },
): Promise<SendResult> {
  return deliver(config, {
    to: args.to,
    message: renderChangeRequestAcknowledgement(args.request),
    tag: "change_requested",
  });
}

export async function sendChangeRequestDecision(
  config: EmailConfig,
  args: { to: string | null | undefined; decision: ChangeRequestDecisionEmail },
): Promise<SendResult> {
  return deliver(config, {
    to: args.to,
    message: renderChangeRequestDecision(args.decision),
    // Separated in the Resend dashboard, because "how many declines went out
    // last month" is a question somebody will ask.
    tag: `change_${args.decision.decision}`,
  });
}
