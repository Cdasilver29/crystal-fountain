import { CAMPAIGN } from "@/content/campaign";
import { formatKES } from "@/lib/format";
import type { RenderedEmail } from "@/server/email/pledge-confirmation";
import type { SettingMove } from "@/server/services/campaign";

/**
 * The message every administrator receives when a campaign setting changes.
 *
 * These apply at once, unlike the payment details, but each one moves
 * something the congregation sees: the target is what the campaign is
 * measured against, and the opening balance moves the public received figure.
 * Nobody should learn that from the home page. Sent immediately, never saved
 * for a digest. Pure, like the other templates.
 */

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const LABELS: Record<string, string> = {
  targetMinor: "Target",
  openingBalanceMinor: "Opening balance",
  autoApproveLimitMinor: "Auto approve limit",
  isPublic: "Pledge form",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A stored value in words: shillings for money, open or closed for the form. */
function shown(field: string, value: unknown): string {
  if (field === "isPublic") return value === true ? "open" : "closed";
  if (value === null || value === undefined) {
    return field === "autoApproveLimitMinor" ? "the default" : "not set";
  }
  if (field.endsWith("Minor") && (typeof value === "string" || typeof value === "number")) {
    return formatKES(BigInt(value));
  }
  return String(value);
}

export function renderSettingsChangedNotice(args: {
  moved: SettingMove[];
  changedByName: string;
  siteUrl: string;
}): RenderedEmail {
  const lines = args.moved.map(
    (m) => `${LABELS[m.field] ?? m.field}: ${shown(m.field, m.was)} to ${shown(m.field, m.now)}`,
  );
  const lead = `${args.changedByName} changed the campaign settings. The change is already live on the site.`;
  const warning =
    "If you did not expect this, tell the development office and the other administrators at once.";
  const url = `${args.siteUrl.replace(/\/$/, "")}/admin/settings`;
  const p = `margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:24px;color:#27272a;`;

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;"><tr><td>
<p style="${p}color:#52525b;font-size:14px;">${escapeHtml(CAMPAIGN.name)}, administrators</p>
<p style="${p}">${escapeHtml(lead)}</p>
<ul style="${p}padding-left:20px;">
${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("\n")}
</ul>
<p style="${p}">${escapeHtml(warning)}</p>
<p style="${p}"><a href="${escapeHtml(url)}" style="color:#052252;">Open the settings page</a></p>
</td></tr></table>
</body></html>`;

  const text = [
    `${CAMPAIGN.name}, administrators`,
    "",
    lead,
    "",
    ...lines.map((line) => `- ${line}`),
    "",
    warning,
    "",
    `Settings: ${url}`,
  ].join("\n");

  return { subject: "Campaign settings changed", html, text };
}
