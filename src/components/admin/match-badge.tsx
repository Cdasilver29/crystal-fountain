import { cn } from "@/lib/utils";

/**
 * Why a pledge was suggested for a payment.
 *
 * In its own file because both the read-only suggestion list, which is a server
 * component, and the allocate panel, which is a client one, render it. Keeping
 * it here means the client bundle picks up this badge and not the rest of the
 * detail screen.
 *
 * The colours carry the ranking: a reference match is the strongest signal and
 * gets the same green as a settled balance, a phone match is a weaker blue, a
 * name match is grey because it is only a guess.
 */

export type MatchReason = "reference" | "phone" | "name";

const STYLES: Record<MatchReason, string> = {
  reference: "bg-emerald-100 text-emerald-900",
  phone: "bg-sky-100 text-sky-900",
  name: "bg-neutral-200 text-neutral-700",
};

const LABELS: Record<MatchReason, string> = {
  reference: "Reference match",
  phone: "Phone match",
  name: "Name match",
};

export function MatchBadge({ reason }: { reason: MatchReason }) {
  return (
    <span
      className={cn(
        "inline-block rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
        STYLES[reason],
      )}
    >
      {LABELS[reason]}
    </span>
  );
}
