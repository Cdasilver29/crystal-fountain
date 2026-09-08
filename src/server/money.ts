/**
 * Money helpers.
 *
 * Every amount in this system is a bigint in minor units (cents). Nothing here
 * returns a JavaScript number for an amount, and nothing here uses floats.
 */

export const MINOR_UNITS_PER_KES = 100n;

/** Shillings to minor units. The input must already be a whole number. */
export function kesToMinor(kes: number): bigint {
  if (!Number.isInteger(kes)) {
    throw new TypeError(
      `kesToMinor expects a whole number of shillings, received ${kes}.`,
    );
  }
  return BigInt(kes) * MINOR_UNITS_PER_KES;
}

/** Minor units to whole shillings, truncated. For display only. */
export function minorToKes(minor: bigint): bigint {
  return minor / MINOR_UNITS_PER_KES;
}

/**
 * A percentage of whole, rounded to two decimals.
 *
 * The arithmetic stays in integer space on the minor units and rounds exactly
 * once, at the end. Scaling by 10000 first keeps two decimal places, and adding
 * half the divisor before dividing rounds half up rather than truncating.
 */
export function percentOf(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0;
  const hundredths = (part * 10000n + whole / 2n) / whole;
  return Number(hundredths) / 100;
}

/** Formats minor units as a KES string, for example "KES 1,500". */
export function formatKes(minor: bigint): string {
  return `KES ${minorToKes(minor).toLocaleString("en-KE")}`;
}
