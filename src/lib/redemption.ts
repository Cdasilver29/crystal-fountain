import { formatKES } from "@/lib/format";
import {
  instalmentMinor,
  REDEMPTION_PLANS,
  type RedemptionChoice,
} from "@/server/contracts/pledges";

/**
 * The one sentence describing a redemption plan.
 *
 * Shared by the form, which shows it live as somebody picks a frequency, and by
 * the confirmation page, which shows it back to them afterwards. One function,
 * so the figure quoted before submitting and the figure quoted after cannot
 * disagree.
 *
 * Null for a one off pledge, which has nothing to divide.
 */
export function redemptionSummary(
  totalMinor: bigint,
  choice: RedemptionChoice,
): string | null {
  const perInstalment = instalmentMinor(totalMinor, choice);

  if (perInstalment === null) return null;

  const plan = REDEMPTION_PLANS[choice];

  return `${formatKES(totalMinor)} ÷ ${plan.instalments} ${plan.periodNoun} = ${formatKES(perInstalment)} ${plan.eachLabel}`;
}
