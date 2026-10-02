import { CAMPAIGN, CONTACT } from "@/content/campaign";
import { formatKES } from "@/lib/format";
import {
  escapePledgerHtml as escapeHtml,
  PLEDGER_PARAGRAPH as PARAGRAPH,
  pledgerFirstName as firstName,
  renderPledgerEmail,
} from "@/server/email/change-request";
import type { RenderedEmail } from "@/server/email/pledge-confirmation";

/**
 * The emails an addition held for confirmation produces.
 *
 * Two go to the address on the pledger's record, which is theirs: one when an
 * addition arrives, so a pledger learns at once if somebody else is adding to
 * their pledge, and one when the treasurer confirms it. Both carry the
 * reference, through the shared pledger layout.
 *
 * The third goes to the address typed on the form when it is not the one on
 * record. Whoever typed it may know nothing more than the pledger's phone
 * number, so it says the addition was received and nothing about any pledge:
 * no reference, no total, no name.
 *
 * Pure, like the other templates.
 */

export type AdditionNoticeEmail = {
  fullName: string;
  reference: string;
  addedMinor: bigint;
  siteUrl: string;
};

/** To the address on record: somebody added to your pledge, we will call. */
export function renderAdditionHeldNotice(email: AdditionNoticeEmail): RenderedEmail {
  const amount = formatKES(email.addedMinor);
  const lines = [
    `Dear ${firstName(email.fullName)},`,
    `We have received an addition of ${amount} to your pledge. Before it is added, the development office will confirm it with you on the phone number on your record. Your pledge stays as it is until then.`,
    `If you did not make this addition, tell the development office when they call, or call ${CONTACT.leaderName} on ${CONTACT.phoneDisplay}.`,
  ];
  return renderPledgerEmail({
    subject: "We received an addition to your pledge",
    preheader: `${amount} waiting to be confirmed with you`,
    body: lines.map((l) => `<p style="${PARAGRAPH}">${escapeHtml(l)}</p>`).join("\n"),
    text: lines.join("\n\n"),
    reference: email.reference,
    siteUrl: email.siteUrl,
  });
}

export type AdditionConfirmedEmail = AdditionNoticeEmail & {
  /** The pledge total after the addition. */
  totalMinor: bigint;
};

/** To the address on record: the treasurer confirmed it, here is the total. */
export function renderAdditionConfirmed(email: AdditionConfirmedEmail): RenderedEmail {
  const lines = [
    `Dear ${firstName(email.fullName)},`,
    `Thank you. Your addition of ${formatKES(email.addedMinor)} is confirmed, and your pledge now stands at ${formatKES(email.totalMinor)}.`,
    "A pledge is a promise to give, not a payment. The treasurer's receipt is the only receipt.",
  ];
  return renderPledgerEmail({
    subject: "Your pledge addition is confirmed",
    preheader: `Your pledge now stands at ${formatKES(email.totalMinor)}`,
    body: lines.map((l) => `<p style="${PARAGRAPH}">${escapeHtml(l)}</p>`).join("\n"),
    text: lines.join("\n\n"),
    reference: email.reference,
    siteUrl: email.siteUrl,
  });
}

/**
 * To an address typed on the form that is not the one on record.
 *
 * Received, and nothing more. Deliberately no reference, no total, no name
 * and no greeting by name, since the person reading may not be the pledger.
 */
export function renderAdditionReceipt(args: { addedMinor: bigint }): RenderedEmail {
  const lines = [
    `Thank you. We have received an addition of ${formatKES(args.addedMinor)}.`,
    "The development office will confirm it with the pledger before it is added.",
    "A pledge is a promise to give, not a payment. The treasurer's receipt is the only receipt.",
    `If you did not make this addition, you can ignore this email, or call ${CONTACT.leaderName} on ${CONTACT.phoneDisplay}.`,
  ];
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Your addition is received</title></head>
<body style="margin:0;padding:24px 12px;background-color:#f4f4f5;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;margin:0 auto;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:8px;">
<tr><td style="padding:28px 24px;">
<p style="${PARAGRAPH}font-weight:600;">${escapeHtml(CAMPAIGN.name)}</p>
${lines.map((l) => `<p style="${PARAGRAPH}">${escapeHtml(l)}</p>`).join("\n")}
</td></tr></table>
</body></html>`;
  return {
    subject: "Your addition is received",
    html,
    text: [CAMPAIGN.name, "", ...lines].join("\n\n"),
  };
}
