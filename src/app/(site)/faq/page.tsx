import type { Metadata } from "next";

import { FaqTabs } from "@/components/content/faq-tabs";
import { SectionBackground } from "@/components/media/section-background";
import { PledgeCta } from "@/components/site/pledge-cta";
import { faqCategories } from "@/content/project";
import { pageMetadata } from "@/lib/metadata";
import { paymentDetails } from "@/lib/payment-details";

/*
 * Rendered per request, not at build time.
 *
 * Two of the giving answers quote the paybill and the bank account, and those
 * can be changed from the admin settings screen. Prerendered, this page kept
 * serving the paybill that was current when the site was last deployed while
 * every other page showed the corrected one, which is the precise failure the
 * settings screen exists to prevent.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "Frequently asked questions",
  description:
    "Answers about the Crystal Fountain Development Project: what is being built, what it costs, how it is funded, and what a pledge is.",
  path: "/faq",
});

/*
 * The giving answers quote the paybill and the bank account, and those can be
 * changed from the admin settings screen without a deploy. Resolved here rather
 * than written into the content module, so a corrected paybill cannot leave
 * this page telling the congregation to send money to the old one.
 */
export default async function FaqPage() {
  const details = await paymentDetails();

  return (
    <>
      {/* Isolated, so the z-10 on the content below stays inside this section
          rather than competing with the fixed header and its phone drawer. */}
      <section className="relative isolate overflow-hidden bg-navy px-4 py-12 sm:px-6 sm:py-16">
        <SectionBackground
          src="/images/gallery/faq.jpg"
          overlayClassName="bg-navy/[0.75]"
        />

        <div className="relative z-10 mx-auto w-full max-w-5xl">
          <h1 className="text-3xl font-semibold tracking-tight text-balance text-white sm:text-4xl">
            Frequently asked questions
          </h1>

          <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/80">
            What the project is, what it costs, and what happens when you record
            a pledge.
          </p>
        </div>
      </section>

      <section className="bg-white px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto w-full max-w-3xl">
          <FaqTabs
            categories={faqCategories({
              paybill: details.paybill,
              accountName: details.accountName,
              bankName: details.bankName,
              bankAccount: details.bankAccount,
            })}
          />
        </div>
      </section>

      <PledgeCta heading="Ready to pledge?" />
    </>
  );
}
