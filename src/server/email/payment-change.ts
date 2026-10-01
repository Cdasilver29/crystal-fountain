import { CAMPAIGN } from "@/content/campaign";
import {
  PAYMENT_DETAIL_FIELDS,
  type PaymentDetailField,
} from "@/server/contracts/campaign";
import type { RenderedEmail } from "@/server/email/pledge-confirmation";
import type { PaymentChangeNotice } from "@/server/services/payment-changes";

/**
 * The message every administrator receives about a payment detail change.
 *
 * Sent the moment a change is asked for, approved, rejected or expires, never
 * saved for a digest. Its whole job is to let a reviewer spot a substitution,
 * so every field is shown old beside new, complete, with the ones that moved
 * marked. A message that said only "the paybill was changed" would make the
 * reader go and look, and the reader who does not go and look is the one a
 * scammer is counting on.
 *
 * Pure, like the other templates: no database, no environment, no request.
 * Tables and inline styles because that is what email clients render.
 */

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const INK = "#27272a";
const MUTED = "#52525b";
const BORDER = "#e4e4e7";
const MOVED_BG = "#fef3c7";

const LABELS: Record<PaymentDetailField, string> = {
  mpesaPaybill: "M-Pesa paybill",
  mpesaAccountName: "M-Pesa account name",
  bankName: "Bank name",
  bankBranch: "Bank branch",
  bankAccountName: "Bank account name",
  bankAccount: "Bank account number",
  bankSwift: "Swift code",
  bankBranchCode: "Branch code",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const nairobi = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Nairobi",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function when(date: Date): string {
  return `${nairobi.format(date)} Nairobi time`;
}

/** What happened, as a subject line and an opening sentence. */
function headline(notice: PaymentChangeNotice): { subject: string; lead: string } {
  switch (notice.event) {
    case "requested":
      return {
        subject: "Payment details change waiting for approval",
        lead: `${notice.requestedByName} has asked to change the payment details members are told to pay to. Nothing has changed on the site yet. A different administrator must approve it before ${when(notice.expiresAt)}, or it expires.`,
      };
    case "approved":
      return {
        subject: "Payment details changed: now live on the site",
        lead: `${notice.decidedByName ?? "An administrator"} approved the change ${notice.requestedByName} asked for. The new details below are now shown to every member.`,
      };
    case "rejected":
      return {
        subject: "Payment details change rejected",
        lead: `${notice.decidedByName ?? "An administrator"} rejected the change ${notice.requestedByName} asked for. The site still shows the current details.`,
      };
    case "expired":
      return {
        subject: "Payment details change expired",
        lead: `Nobody approved the change ${notice.requestedByName} asked for within seven days, so it has expired. The site still shows the current details.`,
      };
  }
}

export function renderPaymentChangeNotice(
  notice: PaymentChangeNotice,
  args: { siteUrl: string },
): RenderedEmail {
  const { subject, lead } = headline(notice);
  const settingsUrl = `${args.siteUrl.replace(/\/$/, "")}/admin/settings`;
  const warning =
    "Check every changed value against what the church actually agreed. If you did not expect this change, do not approve it, and tell the development office and the other administrators at once.";

  const rows = PAYMENT_DETAIL_FIELDS.map((field) => {
    const was = notice.current[field] ?? "";
    const now = notice.proposed[field] ?? "";
    return { field, was, now, moved: was !== now };
  });

  const cell = `padding:8px 10px;border:1px solid ${BORDER};font-family:${FONT};font-size:14px;line-height:20px;color:${INK};vertical-align:top;`;

  const tableRows = rows
    .map(({ field, was, now, moved }) => {
      const bg = moved ? `background:${MOVED_BG};` : "";
      return `<tr>
<td style="${cell}${bg}">${escapeHtml(LABELS[field])}${moved ? " <strong>(changed)</strong>" : ""}</td>
<td style="${cell}${bg}">${was ? escapeHtml(was) : "<em>not set</em>"}</td>
<td style="${cell}${bg}">${now ? escapeHtml(now) : "<em>not set</em>"}</td>
</tr>`;
    })
    .join("\n");

  const p = `margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:24px;color:${INK};`;
  const small = `margin:0 0 16px;font-family:${FONT};font-size:14px;line-height:21px;color:${MUTED};`;

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;">
<tr><td>
<p style="${small}">${escapeHtml(CAMPAIGN.name)}, administrators</p>
<p style="${p}">${escapeHtml(lead)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:0 0 16px;">
<tr>
<th align="left" style="${cell}">Field</th>
<th align="left" style="${cell}">Current</th>
<th align="left" style="${cell}">${notice.event === "approved" ? "Now live" : "Proposed"}</th>
</tr>
${tableRows}
</table>
<p style="${p}">${escapeHtml(warning)}</p>
<p style="${p}"><a href="${escapeHtml(settingsUrl)}" style="color:#052252;">Open the settings page</a></p>
<p style="${small}">Asked for ${escapeHtml(when(notice.requestedAt))}. Change ${escapeHtml(notice.changeId)}.</p>
</td></tr>
</table>
</body></html>`;

  const text = [
    `${CAMPAIGN.name}, administrators`,
    "",
    lead,
    "",
    ...rows.map(
      ({ field, was, now, moved }) =>
        `${LABELS[field]}${moved ? " (changed)" : ""}\n  Current: ${was || "not set"}\n  ${notice.event === "approved" ? "Now live" : "Proposed"}: ${now || "not set"}`,
    ),
    "",
    warning,
    "",
    `Settings: ${settingsUrl}`,
    `Asked for ${when(notice.requestedAt)}. Change ${notice.changeId}.`,
  ].join("\n");

  return { subject, html, text };
}
