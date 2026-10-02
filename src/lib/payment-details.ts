import { BANK, MPESA } from "@/content/campaign";
import { db } from "@/db";
import { CAMPAIGN_SLUG } from "@/lib/campaign";
import type { PaymentDetailField } from "@/server/contracts/campaign";
import { getSettings, type PaymentDetails } from "@/server/services/campaign";

/**
 * Where the money is sent, with the database winning over the repo.
 *
 * The values in src/content/campaign.ts are the ones this installation started
 * with and remain the fallback, so an installation that has never opened the
 * settings screen behaves exactly as it did before. Anything filled in on that
 * screen overrides them, field by field, because a half filled form should not
 * blank out the half somebody did not touch.
 */
export type ResolvedPaymentDetails = {
  paybill: string;
  accountName: string;
  bankName: string;
  bankBranch: string;
  bankAccountName: string;
  bankAccount: string;
  bankSwift: string;
  bankBranchCode: string;
};

export function resolvePaymentDetails(
  settings: PaymentDetails | null,
): ResolvedPaymentDetails {
  const pick = (value: string | null | undefined, fallback: string) =>
    value && value.trim() !== "" ? value : fallback;

  return {
    paybill: pick(settings?.mpesaPaybill, MPESA.paybill),
    accountName: pick(settings?.mpesaAccountName, MPESA.account),
    bankName: pick(settings?.bankName, BANK.bank),
    bankBranch: pick(settings?.bankBranch, BANK.branch),
    bankAccountName: pick(settings?.bankAccountName, BANK.accountName),
    bankAccount: pick(settings?.bankAccount, BANK.accountNumber),
    bankSwift: pick(settings?.bankSwift, BANK.swift),
    bankBranchCode: pick(settings?.bankBranchCode, BANK.branchCode),
  };
}

/** The same thing, read from the database. For server components. */
export async function paymentDetails(): Promise<ResolvedPaymentDetails> {
  try {
    const settings = await getSettings(db, { campaignSlug: CAMPAIGN_SLUG });
    return resolvePaymentDetails(settings);
  } catch {
    // A campaign that cannot be read is not a reason to stop telling somebody
    // how to give. The repo values are correct until somebody changes them.
    return resolvePaymentDetails(null);
  }
}

/**
 * What each payment field shows when the campaign row leaves it empty, keyed
 * the way the settings and the payment change table key them.
 *
 * A reviewer comparing a change has to see what members actually see, and for
 * an empty field that is the value built into the site, not "not set".
 */
export function builtInPaymentDetails(): Record<PaymentDetailField, string> {
  const fallback = resolvePaymentDetails(null);
  return {
    mpesaPaybill: fallback.paybill,
    mpesaAccountName: fallback.accountName,
    bankName: fallback.bankName,
    bankBranch: fallback.bankBranch,
    bankAccountName: fallback.bankAccountName,
    bankAccount: fallback.bankAccount,
    bankSwift: fallback.bankSwift,
    bankBranchCode: fallback.bankBranchCode,
  };
}
