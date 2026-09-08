/**
 * Display formatting. Safe on the client, so it takes minor units as a string
 * or a bigint and never as a number.
 */

const MINOR_UNITS_PER_KES = 100n;

export function toBigInt(minor: bigint | string): bigint {
  return typeof minor === "bigint" ? minor : BigInt(minor);
}

/** Whole shillings, grouped. For example "1,500". */
export function formatKesAmount(minor: bigint | string): string {
  return (toBigInt(minor) / MINOR_UNITS_PER_KES).toLocaleString("en-KE");
}

/** Whole shillings with the currency. For example "KES 1,500". */
export function formatKes(minor: bigint | string): string {
  return `KES ${formatKesAmount(minor)}`;
}

/** Groups a plain shilling figure typed into the amount field. */
export function groupDigits(digits: string): string {
  if (digits === "") return "";
  return Number(digits).toLocaleString("en-KE");
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
