import Link from "next/link";

import { CAMPAIGN, CONTACT } from "@/content/campaign";

/**
 * The warning that sits beside the payment details wherever they are shown.
 *
 * A scammer who wants a member's money does not need to break into anything:
 * a WhatsApp message saying the church has a new number is enough. This says,
 * on the same screen as the real numbers, that there is no other number and
 * who to call if somebody claims there is. The phone comes from the content
 * file, so it cannot drift from the one printed everywhere else.
 */
export function OfficialDetailsNotice({ className }: { className?: string }) {
  return (
    <p
      className={
        className ??
        "container-prose mx-0 rounded-2xl border border-campfire/30 bg-campfire/5 px-4 py-3 text-sm leading-relaxed text-navy"
      }
    >
      These are the only official payment details for the {CAMPAIGN.name}. The
      church will never ask you to pay to a personal number. If anyone does,
      call the development office on{" "}
      <Link
        href={CONTACT.phoneHref}
        className="rounded font-medium text-denim underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
      >
        {CONTACT.phoneDisplay}
      </Link>
      .
    </p>
  );
}
