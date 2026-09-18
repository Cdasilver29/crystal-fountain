import { CAMPAIGN, CONTACT } from "@/content/campaign";
import { formatKES } from "@/lib/format";
import type { ChangeRequestKind } from "@/server/contracts/change-requests";
import { REDEMPTION_PLANS, type RedemptionChoice } from "@/server/contracts/pledges";

import type { RenderedEmail } from "@/server/email/pledge-confirmation";

/**
 * The three messages a change request produces, from one shell.
 *
 * Acknowledging one, and telling somebody it was approved or declined. Three
 * messages and not three files: they are the same campaign writing to the same
 * person about the same request, and three copies of a six hundred line table
 * layout would drift apart the first time anybody adjusted a colour.
 *
 * Pure functions of their input, like the pledge confirmation. Nothing here
 * reads the database, the environment or a request, so a message can be
 * rendered and looked at without sending anything or having an API key.
 *
 * Written the way email has to be written rather than the way the site is:
 * tables for layout, every style inline, no stylesheet, no web font and no
 * image. Gmail strips a style block in some views, Outlook renders with Word,
 * and a remote image is blocked by default.
 */

const NAVY = "#052252";
const GREY_BG = "#f4f4f5";
const BORDER = "#e4e4e7";
const INK = "#27272a";
const MUTED = "#52525b";

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const PARAGRAPH = `margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:24px;color:${INK};`;
const SMALL = `margin:0;font-family:${FONT};font-size:14px;line-height:21px;color:${MUTED};`;

/**
 * Escapes text going into the message.
 *
 * The name and the reason are fields a person typed, into a form anybody can
 * reach. They are interpolated into markup, so they are escaped, and the
 * ampersand goes first so the escapes cannot escape each other.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The first word of the name, falling back rather than producing "Dear ,". */
function firstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : "friend";
}

/** What was asked for, in one phrase, for the body of any of the three. */
export type RequestedChange = {
  kind: ChangeRequestKind;
  requestedAmountMinor: bigint | null;
  requestedFrequency: RedemptionChoice | null;
  requestedName: string | null;
  paymentReference: string | null;
  paymentAmountMinor: bigint | null;
};

/**
 * The sentence that says what this was about.
 *
 * Plain text, not markup: it is escaped where it goes into the HTML and used
 * as it stands in the plain text alternative. Escaping it here would put
 * entities in front of somebody reading the text version.
 * Written from the pledger's side, because they are the reader: "lower your
 * pledge to KES 300,000" rather than the queue's "reduce to KES 300,000". The
 * same facts, addressed to the person who asked rather than the person
 * deciding.
 */
function asked(change: RequestedChange): string {
  switch (change.kind) {
    case "reduce_amount":
      return change.requestedAmountMinor
        ? `lower your pledge to ${formatKES(change.requestedAmountMinor)}`
        : "lower your pledge";

    case "change_plan": {
      const plan = change.requestedFrequency;
      return plan
        ? `change how you are paying to ${REDEMPTION_PLANS[plan].label.toLowerCase()}`
        : "change how you are paying";
    }

    case "correct_name":
      return change.requestedName
        ? `correct your name to ${change.requestedName}`
        : "correct your name";

    case "payment_missing": {
      const ref = change.paymentReference;
      const amount = change.paymentAmountMinor
        ? formatKES(change.paymentAmountMinor)
        : null;
      if (ref && amount) {
        return `look into ${amount} you paid as ${ref} that is not showing against your pledge`;
      }
      if (ref) {
        return `look into a payment, ${ref}, that is not showing against your pledge`;
      }
      return "look into a payment that is not showing against your pledge";
    }

    case "cancel_pledge":
      return "cancel your pledge";
  }
}

type Shell = {
  subject: string;
  preheader: string;
  /** The body, as already escaped HTML paragraphs. */
  body: string;
  /** The same message in plain text, for a client that will not render HTML. */
  text: string;
  reference: string;
  siteUrl: string;
};

/**
 * The layout every one of the three shares.
 *
 * The footer says where to ring, on all three, because the one thing somebody
 * reading any of these might want is a person rather than another form.
 */
function render(shell: Shell): RenderedEmail {
  const site = shell.siteUrl.replace(/\/$/, "");
  const redeemUrl = `${site}/redeem`;
  const reference = escapeHtml(shell.reference);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(shell.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${GREY_BG};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(shell.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${GREY_BG};">
<tr>
<td align="center" style="padding:24px 12px;">

<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:collapse;">

<tr>
<td align="center" style="background-color:${NAVY};padding:28px 24px;border-radius:8px 8px 0 0;">
<p style="margin:0;font-family:${FONT};font-size:19px;font-weight:600;line-height:26px;color:#ffffff;">${CAMPAIGN.name}</p>
<p style="margin:6px 0 0;font-family:${FONT};font-size:13px;line-height:18px;color:#c7d2e4;">${CONTACT.churchName}</p>
</td>
</tr>

<tr>
<td style="background-color:#ffffff;padding:28px 24px;border-left:1px solid ${BORDER};border-right:1px solid ${BORDER};">
${shell.body}
<p style="${PARAGRAPH}margin-bottom:0;">Your reference is <strong>${reference}</strong>. You can look your pledge up at any time at <a href="${redeemUrl}" style="color:#1b4f9c;">${redeemUrl}</a>.</p>
</td>
</tr>

<tr>
<td style="background-color:#ffffff;padding:0 24px 28px;border-left:1px solid ${BORDER};border-right:1px solid ${BORDER};border-bottom:1px solid ${BORDER};border-radius:0 0 8px 8px;">
<hr style="border:0;border-top:1px solid ${BORDER};margin:0 0 16px;">
<p style="${SMALL}">If anything here looks wrong, or you would rather talk to somebody, call ${escapeHtml(CONTACT.leaderName)} on ${escapeHtml(CONTACT.phoneDisplay)}.</p>
</td>
</tr>

</table>
</td>
</tr>
</table>
</body>
</html>`;

  const text = `${shell.text}

Your reference is ${shell.reference}. You can look your pledge up at any time at ${redeemUrl}.

If anything here looks wrong, or you would rather talk to somebody, call ${CONTACT.leaderName} on ${CONTACT.phoneDisplay}.`;

  return { subject: shell.subject, html, text };
}

/* ---------------------------------------------------------------------------
 * The acknowledgement.
 * ------------------------------------------------------------------------- */

export type ChangeRequestAcknowledgementEmail = {
  fullName: string;
  reference: string;
  change: RequestedChange;
  siteUrl: string;
};

/**
 * Telling somebody their request arrived.
 *
 * The whole job of this message is to say that nothing has happened yet.
 * Somebody who asks for their pledge to be halved and then sees the old figure
 * on the site would otherwise reasonably think the request failed, and ring
 * the treasurer about it, which is the call this message exists to prevent.
 */
export function renderChangeRequestAcknowledgement(
  data: ChangeRequestAcknowledgementEmail,
): RenderedEmail {
  const name = escapeHtml(firstName(data.fullName));
  const phrase = asked(data.change);

  return render({
    subject: `We have your request, ${data.reference}`,
    preheader: "Nothing has changed yet. The treasurer will look at this.",
    reference: data.reference,
    siteUrl: data.siteUrl,
    body: `
<p style="${PARAGRAPH}">Dear ${name},</p>
<p style="${PARAGRAPH}">You have asked us to ${escapeHtml(phrase)}.</p>
<p style="${PARAGRAPH}"><strong>Nothing has changed yet.</strong> Your pledge stands exactly as it was until the treasurer has looked at this, and we will write to you again when they have.</p>
<p style="${PARAGRAPH}">You can have one request open at a time, so there is nothing more for you to send.</p>`,
    text: `Dear ${firstName(data.fullName)},

You have asked us to ${phrase}.

Nothing has changed yet. Your pledge stands exactly as it was until the treasurer has looked at this, and we will write to you again when they have.

You can have one request open at a time, so there is nothing more for you to send.`,
  });
}

/* ---------------------------------------------------------------------------
 * The decision.
 * ------------------------------------------------------------------------- */

export type ChangeRequestDecisionEmail = {
  fullName: string;
  reference: string;
  change: RequestedChange;
  decision: "approved" | "declined";
  /** The treasurer's note. Required on a decline, absent on most approvals. */
  note: string | null;
  /** What the pledge says now, so an approval can state the new figure. */
  amountMinor: bigint;
  siteUrl: string;
};

/**
 * Telling somebody what was decided.
 *
 * One function for both answers, because they are the same letter with a
 * different middle: who it is from, what was asked, what was decided, and what
 * that means for the pledge now. Splitting them would mean two places to
 * change when the campaign's wording moves.
 *
 * A decline always carries the treasurer's note, and the note is the message.
 * "No" with nothing after it leaves somebody unable to tell whether to correct
 * something and ask again or to ring, which is why the contract will not
 * accept a decline without one.
 */
export function renderChangeRequestDecision(
  data: ChangeRequestDecisionEmail,
): RenderedEmail {
  const name = escapeHtml(firstName(data.fullName));
  const phrase = asked(data.change);
  const approved = data.decision === "approved";

  const outcome = approved
    ? `<p style="${PARAGRAPH}">The treasurer has <strong>approved</strong> it, and your pledge has been updated.</p>`
    : `<p style="${PARAGRAPH}">The treasurer has <strong>not been able to approve</strong> it. Your pledge is unchanged.</p>`;

  const noteBlock = data.note
    ? `<p style="${PARAGRAPH}">They said: &ldquo;${escapeHtml(data.note)}&rdquo;</p>`
    : "";

  /*
   * A cancelled pledge has no figure worth quoting, and quoting one would read
   * as though it were still owed.
   */
  const standing =
    approved && data.change.kind !== "cancel_pledge"
      ? `<p style="${PARAGRAPH}">Your pledge now stands at <strong>${formatKES(data.amountMinor)}</strong>.</p>`
      : approved && data.change.kind === "cancel_pledge"
        ? `<p style="${PARAGRAPH}">Your pledge has been closed. Thank you for having made it, and for telling us.</p>`
        : "";

  const textOutcome = approved
    ? "The treasurer has approved it, and your pledge has been updated."
    : "The treasurer has not been able to approve it. Your pledge is unchanged.";

  const textStanding =
    approved && data.change.kind !== "cancel_pledge"
      ? `\n\nYour pledge now stands at ${formatKES(data.amountMinor)}.`
      : approved
        ? "\n\nYour pledge has been closed. Thank you for having made it, and for telling us."
        : "";

  return render({
    subject: approved
      ? `Your request was approved, ${data.reference}`
      : `About your request, ${data.reference}`,
    preheader: approved
      ? "Your pledge has been updated."
      : "Your pledge is unchanged.",
    reference: data.reference,
    siteUrl: data.siteUrl,
    body: `
<p style="${PARAGRAPH}">Dear ${name},</p>
<p style="${PARAGRAPH}">You asked us to ${escapeHtml(phrase)}.</p>
${outcome}
${noteBlock}
${standing}`,
    text: `Dear ${firstName(data.fullName)},

You asked us to ${phrase}.

${textOutcome}${data.note ? `\n\nThey said: "${data.note}"` : ""}${textStanding}`,
  });
}
