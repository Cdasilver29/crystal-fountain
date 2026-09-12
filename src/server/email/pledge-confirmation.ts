import { CAMPAIGN, CONTACT } from "@/content/campaign";
import { formatKES } from "@/lib/format";
import {
  instalmentMinor,
  REDEMPTION_PERIOD_MONTHS,
  REDEMPTION_PLANS,
  type PledgeFrequency,
} from "@/server/contracts/pledges";

/**
 * The pledge confirmation email, as a subject line and a string of HTML.
 *
 * A pure function of its input. Nothing here reads the database, the
 * environment or a request: everything it needs, including where the money is
 * sent, arrives on the argument. That keeps it separate from the pledge service
 * per CLAUDE.md, and it means the message can be rendered and looked at without
 * sending anything or having an API key.
 *
 * Written the way email has to be written rather than the way the site is.
 * Tables for layout, every style inline, no stylesheet, no web font and no
 * image, because Gmail strips a <style> block in some views, Outlook renders
 * with Word, and a remote image is blocked by default and would leave a hole
 * where the header ought to be. The whole message therefore has to survive
 * being read as plain boxes of colour and text, which it does.
 */

const NAVY = "#052252";
const CAMPFIRE = "#e36520";
const GREY_BG = "#f4f4f5";
const BORDER = "#e4e4e7";
const INK = "#27272a";
const MUTED = "#52525b";

/** The one font stack, repeated inline because email has no stylesheet. */
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * The three payment fields this message quotes.
 *
 * Declared here rather than imported from @/lib/payment-details on purpose.
 * That module reaches for the database, and nothing else under src/server
 * imports from src/lib, which is the boundary that keeps the domain portable
 * per CLAUDE.md. ResolvedPaymentDetails is structurally assignable to this, so
 * the caller passes it straight in and the two cannot drift apart.
 *
 * formatKES is the one exception and is imported: it is pure, and having the
 * email format money its own way is exactly the drift src/lib/format.ts exists
 * to prevent.
 */
export type EmailPaymentDetails = {
  paybill: string;
  bankName: string;
  bankAccount: string;
};

export type PledgeConfirmationEmail = {
  /** As typed into the form. Only the first word is used, and it is escaped. */
  fullName: string;
  reference: string;
  /** The 22 character public token, for the /p/<token> link. */
  publicToken: string;
  /** The cumulative total on the pledge after this submission, in minor units. */
  amountMinor: bigint;
  /** What this submission added. The same as amountMinor for a first pledge. */
  addedMinor: bigint;
  /** True when this added to a pledge that was already there. */
  isAddition: boolean;
  /** The redemption plan, or null for a one off pledge. */
  installmentFrequency: PledgeFrequency | null;
  /** Where the money is sent. Resolved by the caller, database first. */
  details: EmailPaymentDetails;
  /** The public origin, with no trailing slash. */
  siteUrl: string;
};

export type RenderedEmail = {
  subject: string;
  html: string;
  /** The same message as text, for a client that will not render HTML. */
  text: string;
};

/**
 * Escapes text going into the message.
 *
 * The name is the only field here a person typed, and it is typed into a public
 * form by anybody who cares to. It is interpolated into markup, so it is
 * escaped, and the ampersand is replaced first so the escapes cannot escape
 * each other.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The first word of the name, the same way the recent pledges feed takes it.
 *
 * Falls back to a plain greeting rather than an empty one, because a name that
 * somehow arrives as whitespace should not produce "Dear ,".
 */
function firstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : "friend";
}

/** The instalment sentence, or null when there is no plan to describe. */
function planLine(
  amountMinor: bigint,
  frequency: PledgeFrequency | null,
): string | null {
  if (!frequency) return null;

  const each = instalmentMinor(amountMinor, frequency);
  if (each === null) return null;

  return `Your plan: ${formatKES(each)} ${REDEMPTION_PLANS[frequency].eachLabel} for ${REDEMPTION_PERIOD_MONTHS} months.`;
}

export function renderPledgeConfirmationEmail(
  data: PledgeConfirmationEmail,
): RenderedEmail {
  const name = escapeHtml(firstName(data.fullName));
  const reference = escapeHtml(data.reference);
  const site = data.siteUrl.replace(/\/$/, "");
  const pledgeUrl = `${site}/p/${encodeURIComponent(data.publicToken)}`;
  const redeemUrl = `${site}/redeem`;
  const d = data.details;

  const subject = data.isAddition
    ? `Your pledge has been updated, ${data.reference}`
    : `Your pledge is recorded, ${data.reference}`;

  /*
   * The figure in the thank you is what this submission was for, and the total
   * is stated separately underneath when they differ. Somebody adding KES 5,000
   * to an existing pledge should be thanked for the 5,000 they just made and
   * then told what their pledge now stands at, rather than thanked for a larger
   * number they did not just promise.
   */
  const thanked = formatKES(data.addedMinor);
  const total = formatKES(data.amountMinor);
  const plan = planLine(data.amountMinor, data.installmentFrequency);

  const paragraph = `margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:24px;color:${INK};`;
  const heading = `margin:0 0 8px;font-family:${FONT};font-size:15px;font-weight:600;color:${NAVY};`;
  const detail = `margin:0 0 4px;font-family:${FONT};font-size:15px;line-height:22px;color:${INK};`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${GREY_BG};">
<!-- Shown in the inbox list beside the subject, and nowhere else. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your reference is ${reference}. Keep it safe, you will need it when you pay.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${GREY_BG};">
<tr>
<td align="center" style="padding:24px 12px;">

<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:collapse;">

<!-- Header bar -->
<tr>
<td align="center" style="background-color:${NAVY};padding:28px 24px;border-radius:8px 8px 0 0;">
<p style="margin:0;font-family:${FONT};font-size:19px;font-weight:600;line-height:26px;color:#ffffff;">${CAMPAIGN.name}</p>
<p style="margin:6px 0 0;font-family:${FONT};font-size:13px;line-height:18px;color:#c7d2e4;">${CONTACT.churchName}</p>
</td>
</tr>

<!-- Body -->
<tr>
<td style="background-color:#ffffff;padding:32px 28px;border-left:1px solid ${BORDER};border-right:1px solid ${BORDER};">

<p style="${paragraph}">Dear ${name},</p>

<p style="${paragraph}">Thank you for your pledge of <strong style="color:${NAVY};">${thanked}</strong> toward the ${CAMPAIGN.name}.</p>

${
  data.isAddition
    ? `<p style="${paragraph}">Your pledge has been updated to a total of <strong style="color:${NAVY};">${total}</strong>.</p>`
    : ""
}

${plan ? `<p style="${paragraph}">${escapeHtml(plan)}</p>` : ""}

<!-- Reference box -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 28px;border-collapse:collapse;">
<tr>
<td style="background-color:${GREY_BG};border-left:4px solid ${NAVY};padding:18px 20px;">
<p style="margin:0 0 6px;font-family:${FONT};font-size:15px;color:${MUTED};">Your reference number</p>
<p style="margin:0 0 10px;font-family:${FONT};font-size:28px;font-weight:700;letter-spacing:0.5px;line-height:34px;color:${NAVY};">${reference}</p>
<p style="margin:0;font-family:${FONT};font-size:14px;line-height:21px;color:${MUTED};">Keep this safe. You will need it when making payments and checking your balance.</p>
</td>
</tr>
</table>

<!-- How to pay -->
<p style="margin:0 0 16px;font-family:${FONT};font-size:17px;font-weight:600;color:${NAVY};">How to pay</p>

<p style="${heading}">M-Pesa</p>
<p style="${detail}">1. Go to M-Pesa, Lipa na M-Pesa, Pay Bill</p>
<p style="${detail}">2. Business Number: <strong>${escapeHtml(d.paybill)}</strong></p>
<p style="${detail}">3. Account Number: <strong>${reference}</strong></p>
<p style="margin:0 0 22px;font-family:${FONT};font-size:15px;line-height:22px;color:${INK};">4. Enter amount and confirm</p>

<p style="${heading}">Bank transfer</p>
<p style="${detail}">Bank: <strong>${escapeHtml(d.bankName)}</strong></p>
<p style="${detail}">Account: <strong>${escapeHtml(d.bankAccount)}</strong></p>
<p style="margin:0 0 28px;font-family:${FONT};font-size:15px;line-height:22px;color:${INK};">Reference: <strong>${reference}</strong></p>

<!-- A pledge is not a payment. The confirmation page says this and so does the email. -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;border-collapse:collapse;">
<tr>
<td style="background-color:${GREY_BG};border-left:4px solid ${CAMPFIRE};padding:16px 20px;">
<p style="margin:0;font-family:${FONT};font-size:14px;line-height:21px;color:${MUTED};">A pledge is a promise to give, not a payment. Nothing has been taken from you yet. When you do pay, the treasurer's receipt is the only receipt.</p>
</td>
</tr>
</table>

<!-- Links -->
<p style="margin:0 0 12px;font-family:${FONT};font-size:16px;line-height:24px;color:${INK};">View your pledge anytime:</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;border-collapse:collapse;">
<tr>
<td style="background-color:${CAMPFIRE};border-radius:6px;">
<a href="${pledgeUrl}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">View my pledge</a>
</td>
</tr>
</table>

<p style="margin:0 0 4px;font-family:${FONT};font-size:16px;line-height:24px;color:${INK};">Check your balance:</p>
<p style="margin:0;font-family:${FONT};font-size:16px;line-height:24px;"><a href="${redeemUrl}" style="color:${NAVY};text-decoration:underline;">${escapeHtml(redeemUrl)}</a></p>

</td>
</tr>

<!-- Footer bar -->
<tr>
<td align="center" style="background-color:${GREY_BG};padding:24px;border:1px solid ${BORDER};border-top:none;border-radius:0 0 8px 8px;">
<p style="margin:0 0 4px;font-family:${FONT};font-size:13px;line-height:19px;font-weight:600;color:${NAVY};">${CAMPAIGN.name}</p>
<p style="margin:0 0 4px;font-family:${FONT};font-size:13px;line-height:19px;color:${MUTED};">${CONTACT.churchName}, ${CONTACT.address}</p>
<p style="margin:0;font-family:${FONT};font-size:13px;line-height:19px;"><a href="mailto:${CONTACT.developmentEmail}" style="color:${MUTED};text-decoration:underline;">${CONTACT.developmentEmail}</a></p>
</td>
</tr>

</table>
</td>
</tr>
</table>
</body>
</html>`;

  /*
   * The plain text alternative. Not decoration: a message sent as HTML alone
   * scores worse with spam filters, and this is the version a screen reader or
   * a text only client gets. It carries the same facts in the same order.
   */
  const text = [
    CAMPAIGN.name,
    CONTACT.churchName,
    "",
    `Dear ${firstName(data.fullName)},`,
    "",
    `Thank you for your pledge of ${thanked} toward the ${CAMPAIGN.name}.`,
    ...(data.isAddition
      ? ["", `Your pledge has been updated to a total of ${total}.`]
      : []),
    ...(plan ? ["", plan] : []),
    "",
    `Your reference number: ${data.reference}`,
    "Keep this safe. You will need it when making payments and checking your balance.",
    "",
    "How to pay",
    "",
    "M-Pesa:",
    "1. Go to M-Pesa, Lipa na M-Pesa, Pay Bill",
    `2. Business Number: ${d.paybill}`,
    `3. Account Number: ${data.reference}`,
    "4. Enter amount and confirm",
    "",
    "Bank transfer:",
    `Bank: ${d.bankName}`,
    `Account: ${d.bankAccount}`,
    `Reference: ${data.reference}`,
    "",
    "A pledge is a promise to give, not a payment. Nothing has been taken from",
    "you yet. When you do pay, the treasurer's receipt is the only receipt.",
    "",
    `View your pledge anytime: ${pledgeUrl}`,
    `Check your balance: ${redeemUrl}`,
    "",
    CAMPAIGN.name,
    `${CONTACT.churchName}, ${CONTACT.address}`,
    CONTACT.developmentEmail,
  ].join("\n");

  return { subject, html, text };
}
