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
