/**
 * The bits every chart in the project shares.
 *
 * Plain module, no "use client" of its own. Nothing here touches React, so it
 * can be imported by a client chart component without pulling a second client
 * boundary into the graph, and importing it does not drag recharts anywhere.
 *
 * Amounts arrive as minor unit strings and become plain numbers exactly once,
 * in toShillings. That is the one place in this codebase where a money value
 * legitimately stops being money: a pixel position cannot be a bigint. Every
 * number a reader actually sees is formatted from the original string.
 */

export const NAVY = "#052252";
export const CAMPFIRE = "#e36520";
export const DENIM = "#2f557f";

/** The ageing ramp, recent to overdue. Amber deepening to red. */
export const AGEING_COLOURS = ["#f59e0b", "#ea580c", "#dc2626", "#991b1b"] as const;

export const GRID = "#e5e5e5";
export const AXIS_TEXT = "#737373";

/** Minor units to whole shillings as a number, for chart geometry only. */
export function toShillings(minor: string): number {
  return Number(BigInt(minor) / 100n);
}

/**
 * An axis tick: the magnitude, with no currency on it.
 *
 * formatKESCompact returns "KES 550.0M", which wrapped onto two lines in the
 * axis gutter and made the chart look broken. The axis is entirely shillings
 * and the section says so, so the prefix is noise repeated at every tick. The
 * tooltip and the cards still carry it, because there it is the only thing
 * saying what the number is.
 */
export function axisTick(shillings: number): string {
  const value = Math.round(shillings);
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

/** A full date for a tooltip heading, in the campaign's own locale. */
export function tooltipDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-KE", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
