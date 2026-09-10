/**
 * Display formatting, shared by every surface that shows a figure.
 *
 * Money is taken as minor units in a bigint or a string and never as a
 * JavaScript number, per CLAUDE.md. A string is accepted because unstable_cache
 * serialises bigint on the way out of the cache; it is still exact minor units.
 *
 * One formatter, used everywhere, so the home tracker, the pledge form, the
 * confirmation page and the admin table cannot drift apart.
 */

const MINOR_UNITS_PER_KES = 100n;

const KES = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const PLAIN = new Intl.NumberFormat("en-KE");

/**
 * Rebuilds the currency prefix.
 *
 * en-KE renders this currency as "Ksh" joined by a non-breaking space, so the
 * raw Intl output would put "Ksh 1,000,000" in front of the congregation, and
 * the separator would not be an ordinary space. Rather than matching the
 * particular symbol and whitespace a runtime happens to choose, everything
 * ahead of the first digit is dropped and the prefix the church uses is put
 * back. A leading minus is kept.
 */
function normaliseKes(formatted: string): string {
  const negative = formatted.trimStart().startsWith("-");
  const digits = formatted.replace(/^[^\d]*/, "");
  return `KES ${negative ? "-" : ""}${digits}`;
}

export function toBigInt(minor: bigint | string): bigint {
  return typeof minor === "bigint" ? minor : BigInt(minor);
}

/** Whole shillings with the currency. For example "KES 1,500". */
export function formatKES(minor: bigint | string): string {
  return normaliseKes(KES.format(toBigInt(minor) / MINOR_UNITS_PER_KES));
}

/** A plain count, grouped. For example "1,500". Never used for money. */
export function formatNumber(value: number): string {
  return PLAIN.format(value);
}

/** A percentage that is already out of 100. For example "0.18%". */
export function formatPercent(value: number, decimals = 2): string {
  return `${new Intl.NumberFormat("en-KE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)}%`;
}

/** Groups a plain shilling figure typed into the amount field. */
export function groupDigits(digits: string): string {
  if (digits === "") return "";
  return formatNumber(Number(digits));
}

/** Renders +254712345678 as "+254 712 345 678". */
export function formatPhoneForDisplay(e164: string): string {
  const match = e164.match(/^\+254(\d{3})(\d{3})(\d{3})$/);
  return match ? `+254 ${match[1]} ${match[2]} ${match[3]}` : e164;
}

export function formatDate(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString("en-KE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * A large amount, shortened for a chart axis or a metric card.
 *
 * "KES 1.2M", "KES 125K", "KES 900". Charts and small cards have no room for
 * eleven digits, and a reader scanning an axis wants the magnitude rather than
 * the exact figure. Anywhere the exact figure matters, formatKES is still the
 * one to use.
 *
 * The rounding happens on whole shillings, after the division out of minor
 * units, so this never turns a money value into a float before it has already
 * stopped being money and become a label.
 */
export function formatKESCompact(minor: bigint | string): string {
  const shillings = toBigInt(minor) / MINOR_UNITS_PER_KES;
  const negative = shillings < 0n;
  const value = negative ? -shillings : shillings;
  const sign = negative ? "-" : "";

  if (value >= 1_000_000_000n) {
    return `KES ${sign}${(Number(value) / 1_000_000_000).toFixed(1)}B`;
  }
  if (value >= 1_000_000n) {
    return `KES ${sign}${(Number(value) / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000n) {
    return `KES ${sign}${Math.round(Number(value) / 1_000)}K`;
  }
  return `KES ${sign}${value}`;
}

/** "Jul 25", "Sep 26". A chart axis tick, not a date anybody has to act on. */
export function formatMonthShort(value: Date | string): string {
  const date = typeof value === "string" ? new Date(`${value.slice(0, 10)}T12:00:00Z`) : value;
  return date.toLocaleDateString("en-KE", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

/**
 * How long ago something happened, in words.
 *
 * "just now", "2 hours ago", "yesterday", "3 days ago", and a plain date once
 * it is older than a week, because "23 days ago" is arithmetic the reader has
 * to do and a date is not.
 *
 * Rendered on the server and then polled, so the wording is only as fresh as
 * the last refresh. That is the right trade for a feed: a line that says two
 * hours when it has been two hours and a minute is nobody's problem, and
 * re-rendering the page every minute to keep a phrase exact would be.
 */
export function formatRelativeTime(value: Date | string, now = new Date()): string {
  const then = typeof value === "string" ? new Date(value) : value;
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  // A clock a little behind the server's reads as the present, not the future.
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;

  return formatDate(then);
}
