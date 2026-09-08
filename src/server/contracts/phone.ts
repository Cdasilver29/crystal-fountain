import { z } from "zod";

/**
 * Kenyan mobile numbers, normalised to E.164.
 *
 * The phone number is the pledger's primary identity key, so two spellings of
 * the same number must never produce two pledger rows. Everything is reduced to
 * +254XXXXXXXXX before it reaches the database.
 *
 * Accepted input: 0712345678, 0112345678, +254712345678, 254712345678,
 * 00254712345678, 712345678, with any spaces, dashes, dots or brackets.
 */

const KE_COUNTRY_CODE = "254";

// Safaricom, Airtel and Telkom mobile prefixes sit under 7, and the newer
// range under 1. Nine digits after the country code either way.
const KE_SUBSCRIBER = /^[17]\d{8}$/;

export function normalizeKenyanPhone(raw: string): string | null {
  let cleaned = raw.replace(/[\s()\-.]/g, "");

  // International dialling prefix, 00254...
  if (cleaned.startsWith("00")) {
    cleaned = cleaned.slice(2);
  }

  let subscriber: string;

  if (cleaned.startsWith(`+${KE_COUNTRY_CODE}`)) {
    subscriber = cleaned.slice(KE_COUNTRY_CODE.length + 1);
  } else if (cleaned.startsWith(KE_COUNTRY_CODE)) {
    subscriber = cleaned.slice(KE_COUNTRY_CODE.length);
  } else if (cleaned.startsWith("0")) {
    subscriber = cleaned.slice(1);
  } else {
    subscriber = cleaned;
  }

  if (!KE_SUBSCRIBER.test(subscriber)) {
    return null;
  }

  return `+${KE_COUNTRY_CODE}${subscriber}`;
}

export const kenyanPhone = z
  .string()
  .trim()
  .min(1, "Enter a phone number.")
  .transform((value, ctx) => {
    const normalized = normalizeKenyanPhone(value);

    if (normalized === null) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a Kenyan mobile number, for example 0712 345 678.",
      });
      return z.NEVER;
    }

    return normalized;
  });
