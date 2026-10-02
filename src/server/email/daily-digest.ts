import { CAMPAIGN } from "@/content/campaign";
import { formatKES } from "@/lib/format";
import type { RenderedEmail } from "@/server/email/pledge-confirmation";
import { escapeHtml } from "@/server/email/safe";
import { describeSettingMove } from "@/server/email/settings-change";
import type { DigestData } from "@/server/services/digest";

/**
 * The daily digest, to administrators and treasurers.
 *
 * Short on purpose: a count and a link for each thing, so the reader can see
 * in a few seconds whether anything needs them, and go straight to it. Names
 * and amounts only, never a phone number or an address.
 *
 * Pure, like the other templates.
 */

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const INK = "#27272a";
const MUTED = "#52525b";

const nairobi = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Nairobi",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const PAYMENT_EVENTS: Record<string, string> = {
  "campaign.payment_change_requested": "Payment details change requested",
  "campaign.payment_change_approved": "Payment details change approved and live",
  "campaign.payment_change_rejected": "Payment details change rejected",
  "campaign.payment_change_expired": "Payment details change expired",
};

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

type Line = { text: string; href?: string };

export function renderDailyDigest(
  data: DigestData,
  args: { siteUrl: string; windowHours: 24 | 48 },
): RenderedEmail {
  const site = args.siteUrl.replace(/\/$/, "");
  const period = args.windowHours === 48 ? "48 hours" : "24 hours";
  const p = data.pledges;
  const w = data.waiting;

  const received: Line[] =
    p.count === 0
      ? [{ text: `No pledges in the last ${period}.` }]
      : [
          {
            text: `${plural(p.count, "pledge", "pledges")} in the last ${period} (${p.newPledges} new, ${p.additions} added to existing), ${formatKES(p.totalMinor)} in total.`,
            href: `${site}/admin/pledges`,
          },
          ...(p.largest
            ? [
                {
                  text: `Largest: ${formatKES(p.largest.amountMinor)} from ${p.largest.name}, ${p.largest.reference}.`,
                  href: `${site}/admin/pledges/${p.largest.pledgeId}`,
                },
              ]
            : []),
        ];

  const waiting: Line[] = ([
    w.heldAdditions > 0 && {
      text: `${plural(w.heldAdditions, "held addition", "held additions")} to confirm with the pledger.`,
      href: `${site}/admin/held-additions`,
    },
    w.changeRequests > 0 && {
      text: `${plural(w.changeRequests, "change request", "change requests")} to answer.`,
      href: `${site}/admin/change-requests`,
    },
    w.pendingPledges > 0 && {
      text: `${plural(w.pendingPledges, "pledge", "pledges")} pending approval.`,
      href: `${site}/admin/pledges?status=pending`,
    },
    w.pendingPaymentChanges > 0 && {
      text: `${plural(w.pendingPaymentChanges, "payment details change", "payment details changes")} waiting for a second person.`,
      href: `${site}/admin/settings`,
    },
  ] as (Line | false)[]).filter((line): line is Line => line !== false);

  const settings: Line[] = data.settings.flatMap((event) => {
    const when = nairobi.format(event.at);
    const by = event.byName ?? "the system";
    if (event.action === "campaign.updated") {
      return event.moves.map((m) => ({
        text: `${describeSettingMove(m.field, m.was, m.now)}, by ${by}, ${when}.`,
        href: `${site}/admin/settings`,
      }));
    }
    return [
      {
        text: `${PAYMENT_EVENTS[event.action] ?? event.action}, by ${by}, ${when}.`,
        href: `${site}/admin/settings`,
      },
    ];
  });

  const sections: { title: string; lines: Line[] }[] = [
    { title: "Received", lines: received },
    {
      title: "Waiting",
      lines: waiting.length > 0 ? waiting : [{ text: "Nothing is waiting." }],
    },
    ...(settings.length > 0
      ? [{ title: `Settings changed in the last ${period}`, lines: settings }]
      : []),
  ];

  const waitingCount =
    w.heldAdditions + w.changeRequests + w.pendingPledges + w.pendingPaymentChanges;
  const subject = `Daily summary: ${plural(p.count, "pledge", "pledges")}, ${waitingCount} waiting`;

  const para = `margin:0 0 8px;font-family:${FONT};font-size:15px;line-height:22px;color:${INK};`;
  const heading = `margin:20px 0 8px;font-family:${FONT};font-size:16px;font-weight:600;color:#052252;`;

  const htmlLine = (line: Line) =>
    line.href
      ? `<p style="${para}">${escapeHtml(line.text)} <a href="${escapeHtml(line.href)}" style="color:#052252;">Open</a></p>`
      : `<p style="${para}">${escapeHtml(line.text)}</p>`;

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;"><tr><td>
<p style="margin:0 0 4px;font-family:${FONT};font-size:14px;color:${MUTED};">${escapeHtml(CAMPAIGN.name)}, administrators</p>
<p style="margin:0;font-family:${FONT};font-size:14px;color:${MUTED};">Since ${escapeHtml(nairobi.format(data.since))} Nairobi time</p>
${sections
  .map(
    (s) => `<p style="${heading}">${escapeHtml(s.title)}</p>
${s.lines.map(htmlLine).join("\n")}`,
  )
  .join("\n")}
<p style="margin:24px 0 0;font-family:${FONT};font-size:13px;line-height:19px;color:${MUTED};">Sent to administrators and treasurers each day except the Sabbath. Saturday's summary is folded into Sunday's.</p>
</td></tr></table>
</body></html>`;

  const text = [
    `${CAMPAIGN.name}, administrators`,
    `Since ${nairobi.format(data.since)} Nairobi time`,
    ...sections.flatMap((s) => [
      "",
      s.title,
      ...s.lines.map((l) => (l.href ? `- ${l.text} ${l.href}` : `- ${l.text}`)),
    ]),
    "",
    "Sent to administrators and treasurers each day except the Sabbath. Saturday's summary is folded into Sunday's.",
  ].join("\n");

  return { subject, html, text };
}
