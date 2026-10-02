import { CONTACT } from "@/content/campaign";
import { formatKES } from "@/lib/format";
import {
  PLEDGER_PARAGRAPH as PARAGRAPH,
  renderPledgerEmail,
} from "@/server/email/change-request";
import type { RenderedEmail } from "@/server/email/pledge-confirmation";
import { escapeHtml, greeting } from "@/server/email/safe";

/**
 * The emails an addition held for confirmation produces.
 *
 * Two go to the address on the pledger's record, which is theirs: one when an
 * addition arrives, so a pledger learns at once if somebody else is adding to
 * their pledge, and one when the treasurer confirms it. Both carry the
 * reference, through the shared pledger layout.
 *
 * Nothing goes to an address typed on the form. Whoever typed it may know
 * nothing more than the pledger's phone number, and mailing whatever address
 * a stranger enters would let anybody make the church's domain email anyone.
 * The on screen acknowledgement is their receipt.
 *
 * Every field here comes from the record, never from what the submitter
 * typed: the name is the pledger's own, and the amount is the held
 * increment as stored.
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
    `${greeting(email.fullName)},`,
    `We have received an addition of ${amount} to your pledge. Before it is added, the development office will confirm it with you on the phone number on your record. Your pledge stays as it is until then.`,
    `If this was not you, contact the development office on ${CONTACT.phoneDisplay}.`,
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
    `${greeting(email.fullName)},`,
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
