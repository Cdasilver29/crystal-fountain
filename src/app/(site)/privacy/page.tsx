import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { CAMPAIGN, CONTACT } from "@/content/campaign";
import { PRIVACY_VERSION } from "@/server/contracts/pledges";
import { pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata({
  title: "Privacy notice",
  description:
    "How Newlife SDA Church collects, uses and stores the information you give when you record a pledge.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <div className="bg-white">
      <header className="bg-navy px-4 py-10 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-tight text-white">
            Privacy
          </h1>
          <p className="mt-2 text-white/70">
            How we handle the information you give when you record a pledge.
          </p>
        </div>
      </header>

      <main className="px-4 py-10 pb-16 sm:px-6">
        <div className="mx-auto w-full max-w-3xl space-y-8">
          <Section title="What we collect">
            <p>
              Your name, your phone number, and the amount you pledge. Your
              email address and your church membership number are optional, and
              the form works without them.
            </p>
            <p className="mt-3">
              We do not ask for your national ID number, and no part of this
              site accepts one.
            </p>
          </Section>

          <Section title="Why we collect it">
            <p>
              To record and manage pledges toward the {CAMPAIGN.name}, and to
              match contributions to the pledges they belong to.
            </p>
          </Section>

          <Section title="Who sees it">
            <p>
              The church development team and the treasury. Your first name and
              pledge amount appear in the recent pledges feed on this site only
              if you gave explicit consent by ticking the box that says so.
              Your full name is never shown. That box is never ticked for you,
              and you can pledge without ticking it.
            </p>
          </Section>

          <Section title="How it is stored">
            <p>
              In a secure database. Your phone number is used to verify your
              identity and to match your contributions to your pledge, which is
              why it is the one contact detail we ask for.
            </p>
          </Section>

          <Section title="How long we keep it">
            <p>
              Pledge records are kept for the duration of the project and for
              the retention period the law requires for financial records.
            </p>
          </Section>

          <Section title="Your rights">
            <p>
              You may ask to see the data we hold about you, to have it
              corrected, or to have it deleted. Contact the church office and we
              will help.
            </p>
          </Section>

          <Section title="Contact">
            <p>{CONTACT.churchName}</p>
            <p>{CONTACT.address}</p>
            <p className="mt-2">
              <a
                href={`mailto:${CONTACT.email}`}
                className="rounded text-denim underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
              >
                {CONTACT.email}
              </a>
            </p>
          </Section>

          <div className="rounded-2xl bg-navy/5 p-5 text-sm leading-relaxed text-navy">
            <p>
              This platform is operated by {CONTACT.churchName} under the Kenya
              Data Protection Act 2019. The church is pursuing registration with
              the Office of the Data Protection Commissioner.
            </p>
            <p className="mt-3 text-navy/70">
              Notice version {PRIVACY_VERSION}. The version in force when you
              pledged is recorded against your consent.
            </p>
          </div>

          <p className="text-sm text-neutral-600">
            <Link href="/pledge" className="rounded text-denim underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none">
              Back to the pledge form
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold tracking-tight text-navy">{title}</h2>
      <div className="mt-2 leading-relaxed text-neutral-700">{children}</div>
    </section>
  );
}
