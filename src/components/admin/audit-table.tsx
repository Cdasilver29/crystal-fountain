import type { AuditRow } from "@/server/services/audit";

/**
 * The audit journal as a table.
 *
 * A server component. Nothing here is interactive, so none of it needs to
 * reach the browser as JavaScript: the filters are a separate client component
 * and paging is a link.
 *
 * Read only by construction. There is no control on this screen that changes
 * anything, because the whole value of the journal is that the people it
 * describes cannot curate it.
 */

/** What a badge means, and what it looks like. */
type Tone = "green" | "amber" | "red" | "grey";

const TONE_CLASSES: Record<Tone, string> = {
  green: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  red: "bg-red-50 text-red-800 ring-red-600/20",
  grey: "bg-neutral-100 text-neutral-700 ring-neutral-500/20",
};

/**
 * The colour of each action.
 *
 * Exported because the verification asserts against it rather than against the
 * rendered markup, so a colour cannot quietly change without the check that
 * describes it changing too.
 *
 * Green is something being brought into existence or approved, amber is
 * something changing or leaving the building, red is destructive or refused,
 * grey is a fact with no weight either way.
 *
 * Three of these are not in the original brief but are in the table: admin.created,
 * pledge.unfulfilled and guard.test. They are mapped by the same rule as their
 * neighbours rather than left to the fallback.
 */
export const AUDIT_TONES: Record<string, Tone> = {
  // Green: created or approved.
  "pledge.created": "green",
  "pledge.increased": "green",
  "pledge.approved": "green",
  "pledge.auto_approved": "green",
  "payment.recorded": "green",
  "payment.allocated": "green",
  "admin.created": "green",

  // Amber: changed, or data leaving the building.
  "pledge.fulfilled": "amber",
  "admin.export": "amber",

  // Red: destructive, reversed or refused.
  "pledge.voided": "red",
  "pledge.unfulfilled": "red",
  "payment.deallocated": "red",
  "admin.login_failed": "red",
  "admin.login_locked": "red",
  "admin.forbidden": "red",

  // Grey: neutral.
  "admin.login": "grey",
  "admin.logout": "grey",
  "admin.totp_enrolled": "grey",
  "guard.test": "grey",
};

/**
 * Grey for anything unrecognised.
 *
 * An action this table has never heard of still has to render, and rendering
 * it in a colour that implies something would be worse than rendering it
 * plainly. A new action shows up grey until somebody decides what it means.
 */
export function toneFor(action: string): Tone {
  return AUDIT_TONES[action] ?? "grey";
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * "10 Sep 2026, 16:32", in the campaign's own timezone.
 *
 * The parts are read in Africa/Nairobi and reassembled by hand rather than
 * handed to toLocaleDateString with month: "short". Both en-GB and en-KE
 * abbreviate September as "Sept" in current ICU, and a journal column whose
 * width and wording shift when the runtime's ICU data is updated is not a
 * journal anybody can read at a glance. The month names are ours, so the
 * format is fixed.
 */
export function formatAuditTime(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Nairobi",
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const month = MONTHS[Number(get("month")) - 1] ?? get("month");
  // en-US renders midnight as "24" in the hour-cycle it picks for hour12:false.
  const hour = get("hour") === "24" ? "00" : get("hour");

  return `${Number(get("day"))} ${month} ${get("year")}, ${hour}:${get("minute")}`;
}

/**
 * Who did it.
 *
 * A public row is somebody with no session, which is what a pledge from the
 * web form and a failed sign in both are. A system row is the platform acting
 * on its own, such as the nightly snapshot. Neither has a name to show, and
 * saying so is more honest than an empty cell.
 */
export function actorLabel(row: {
  actorType: string;
  actorName: string | null;
}): string {
  if (row.actorName) return row.actorName;
  if (row.actorType === "system") return "System";
  if (row.actorType === "public") return "Public";
  if (row.actorType === "webhook") return "Webhook";
  // An admin row whose account has since been deleted.
  return "Unknown";
}

function Badge({ action }: { action: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${TONE_CLASSES[toneFor(action)]}`}
    >
      {action}
    </span>
  );
}

export function AuditTable({ rows }: { rows: AuditRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-black/5 bg-white p-8 text-center shadow-sm">
        <p className="text-sm text-neutral-600">
          Nothing in the journal matches that.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
      {/* The table scrolls sideways on a narrow screen rather than wrapping
          every cell into an unreadable stack. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50">
              <th scope="col" className="px-4 py-3 font-medium text-neutral-600">
                Timestamp
              </th>
              <th scope="col" className="px-4 py-3 font-medium text-neutral-600">
                Actor
              </th>
              <th scope="col" className="px-4 py-3 font-medium text-neutral-600">
                Action
              </th>
              <th scope="col" className="px-4 py-3 font-medium text-neutral-600">
                Entity
              </th>
              <th scope="col" className="px-4 py-3 font-medium text-neutral-600">
                Detail
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-neutral-100 last:border-0"
              >
                <td className="tabular px-4 py-3 whitespace-nowrap text-neutral-600">
                  {formatAuditTime(row.at)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-navy">
                  {actorLabel(row)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <Badge action={row.action} />
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-neutral-600">
                  {row.entity}
                </td>
                <td className="px-4 py-3 text-neutral-700">
                  {row.detail || (
                    <span className="text-neutral-400">no detail recorded</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
