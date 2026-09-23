import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AdminNav } from "@/components/admin/admin-nav";
import { pendingChangeRequestCount } from "@/lib/admin-badges";
import { PledgeDelete } from "@/components/admin/pledge-delete";
import { PledgeEdit } from "@/components/admin/pledge-edit";
import { PledgerOrganisation } from "@/components/admin/pledger-organisation";
import { PledgerPublicName } from "@/components/admin/pledger-public-name";
import { db } from "@/db";
import { getCurrentAdmin } from "@/lib/admin-context";
import { formatDate, formatKES, formatPhoneForDisplay } from "@/lib/format";
import { can } from "@/lib/permissions";
import { redemptionSummary } from "@/lib/redemption";
import { REDEMPTION_PLANS } from "@/server/contracts/pledges";
import { displayName } from "@/server/display-name";
import * as pledges from "@/server/services/pledges";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pledge",
  robots: { index: false, follow: false },
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One pledge, whole.
 *
 * Every role that can see the pledge list can open this, because reading the
 * books is what a viewer is for. Correcting it is the admin role, and the Edit
 * control is simply absent below that; the route behind it makes the same call
 * and writes an admin.forbidden row if anyone posts at it directly.
 *
 * This is the one screen that shows a pledger's phone number and email address
 * whole. The treasurer matching an M-Pesa receipt needs the number, and it is
 * behind the portal and the rights table. Nothing public in this codebase can
 * return either.
 *
 * The increments are shown as a list rather than summed into the amount,
 * because that list is the answer to "why does this say five million" and it is
 * the thing a correction is supposed to preserve.
 */
export default async function AdminPledgeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const admin = await getCurrentAdmin();

  if (!admin) redirect(`/admin/login?next=/admin/pledges/${id}`);

  // A temporary password is still somebody else's. Nothing opens until it
  // has been changed.
  if (admin.mustChangePassword) redirect("/admin/change-password");

  if (!can(admin, "pledges.view")) notFound();
  if (!UUID.test(id)) notFound();

  const pledge = await pledges.getForAdmin(db, { pledgeId: id });

  if (!pledge) notFound();

  const plan = pledge.installmentFrequency;
  const planSummary = plan
    ? redemptionSummary(pledge.amountMinor, plan)
    : null;

  // What the pledger chose on the form, taken from the first submission. Later
  // corrections carry no category, because a correction is not a choice.
  const origin = pledge.increments.find((i) => i.category || i.tier);

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-50">
      <header className="bg-navy page-gutter py-5">
        <div className="container-table">
          <AdminNav
            name={admin.name}
            role={admin.role}
            isSuper={admin.isSuper}
            pendingChangeRequests={await pendingChangeRequestCount(admin)}
          />
        </div>
      </header>

      <main className="page-gutter py-8 pb-16">
        <div className="container-table space-y-6">
          <div>
            <Link
              href="/admin/pledges"
              className="rounded text-sm text-denim underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
            >
              Back to pledges
            </Link>

            <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="tabular text-3xl font-semibold tracking-tight text-navy">
                  {pledge.reference}
                </h1>
                <p className="mt-1 text-neutral-600">
                  {pledge.fullName} &middot; {pledge.status}
                </p>
              </div>

              {can(admin, "pledges.edit") && (
                <PledgeEdit
                  pledge={{
                    id: pledge.id,
                    amountMinor: pledge.amountMinor.toString(),
                    status: pledge.status,
                    installmentFrequency: pledge.installmentFrequency,
                    note: pledge.note,
                  }}
                />
              )}
            </div>
          </div>

          <section className="grid gap-4 sm:grid-cols-3">
            <Figure label="Pledged" value={formatKES(pledge.amountMinor)} />
            <Figure label="Paid" value={formatKES(pledge.paidMinor)} />
            <Figure
              label="Outstanding"
              value={formatKES(pledge.outstandingMinor)}
              accent
            />
          </section>

          <section className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="font-semibold text-navy">The pledger</h2>
            <dl className="mt-4 divide-y divide-neutral-100 text-sm">
              <Row label="Name">{pledge.fullName}</Row>
              <Row label="Phone">
                <span className="tabular">
                  {formatPhoneForDisplay(pledge.phone)}
                </span>
              </Row>
              <Row label="Email">{pledge.email ?? "Not given"}</Row>
              <Row label="Membership">{pledge.membershipNo ?? "Not given"}</Row>
              <Row label="Contact consent">
                {pledge.contactConsent ? "Yes" : "No"}
              </Row>
              <Row label="Shown in the feed">
                {pledge.displayConsent ? "Yes" : "No"}
              </Row>
              <Row label="Kind">
                {pledge.isOrganisation ? "Organisation" : "Individual"}
              </Row>
            </dl>

            {/*
              What the public pages render for this pledger, worked out by the
              same function they use. Only a consented name has a public form,
              so without consent this says so and offers nothing to edit.
            */}
            <div className="mt-2 border-t border-neutral-100 pt-4 text-sm">
              <p className="text-neutral-500">Shown publicly as</p>
              <div className="mt-1.5">
                {pledge.displayConsent && pledge.displayName ? (
                  <PledgerPublicName
                    pledgeId={pledge.id}
                    shownAs={displayName(pledge.displayName, {
                      isOrganisation: pledge.isOrganisation,
                      override: pledge.publicDisplayName,
                    })}
                    isOverride={pledge.publicDisplayName !== null}
                    canEdit={can(admin, "pledgers.setDisplayName")}
                  />
                ) : (
                  <p className="font-medium text-navy">Not shown publicly</p>
                )}
              </div>
            </div>

            {/*
              The treasurer sets this, so it sits with the pledger rather than
              with the pledge. A viewer sees the row above and no control, which
              is the same answer the route gives them if they ask it directly.
            */}
            {can(admin, "pledgers.setOrganisation") && (
              <div className="mt-5 border-t border-neutral-100 pt-5">
                <PledgerOrganisation
                  pledgeId={pledge.id}
                  storedName={pledge.displayName}
                  initial={pledge.isOrganisation}
                  displayConsent={pledge.displayConsent}
                  publicDisplayName={pledge.publicDisplayName}
                />
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="font-semibold text-navy">The pledge</h2>
            <dl className="mt-4 divide-y divide-neutral-100 text-sm">
              <Row label="Status">{pledge.status}</Row>
              <Row label="Redemption plan">
                {plan ? (
                  <span className="text-right">
                    {REDEMPTION_PLANS[plan].label}
                    {planSummary && (
                      <span className="tabular block text-xs font-normal text-neutral-500">
                        {planSummary}
                      </span>
                    )}
                  </span>
                ) : (
                  "One-off payment"
                )}
              </Row>
              <Row label="Pledged as">
                {origin?.category
                  ? origin.category === "family"
                    ? "Family or group"
                    : "Individual"
                  : "Not recorded"}
              </Row>
              <Row label="Tier">{origin?.tier ?? "Not recorded"}</Row>
              <Row label="Channel">{pledge.channel}</Row>
              <Row label="Recorded">{formatDate(pledge.createdAt)}</Row>
              <Row label="Confirmed">
                {pledge.verifiedAt ? formatDate(pledge.verifiedAt) : "Not yet"}
              </Row>
              <Row label="Last changed">{formatDate(pledge.updatedAt)}</Row>
              <Row label="Note">{pledge.note ?? "None"}</Row>
              <Row label="Public link">
                <Link
                  href={`/p/${pledge.publicToken}`}
                  className="rounded text-denim underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
                >
                  Open what the pledger sees
                </Link>
              </Row>
            </dl>
          </section>

          <section className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="font-semibold text-navy">What it is made of</h2>
            <p className="mt-1 text-sm text-neutral-600">
              Every submission and every correction. These sum to the pledged
              amount, and the database refuses any commit where they do not.
            </p>

            <ul className="mt-4 divide-y divide-neutral-100 text-sm">
              {pledge.increments.map((increment) => (
                <li
                  key={increment.id}
                  className="flex items-baseline justify-between gap-4 py-3"
                >
                  <div className="min-w-0">
                    <span className="text-neutral-600">
                      {formatDate(increment.createdAt)} &middot;{" "}
                      {increment.channel}
                    </span>
                    {increment.reason && (
                      <span className="block text-xs text-neutral-500">
                        {increment.reason}
                      </span>
                    )}
                  </div>
                  <span
                    className={
                      increment.amountMinor < 0n
                        ? "tabular shrink-0 font-semibold text-red-700"
                        : "tabular shrink-0 font-semibold text-navy"
                    }
                  >
                    {increment.amountMinor < 0n ? "-" : "+"}
                    {formatKES(
                      increment.amountMinor < 0n
                        ? -increment.amountMinor
                        : increment.amountMinor,
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="font-semibold text-navy">Payments against it</h2>

            {pledge.payments.length === 0 ? (
              <p className="mt-3 text-sm text-neutral-600">
                Nothing has been matched to this pledge yet.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-neutral-100 text-sm">
                {pledge.payments.map((payment) => (
                  <li
                    key={payment.allocationId}
                    className="flex items-baseline justify-between gap-4 py-3"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/admin/payments/${payment.paymentId}`}
                        className="rounded font-medium text-denim underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
                      >
                        {formatDate(payment.paidAt)} &middot; {payment.method}
                      </Link>
                      <span className="block text-xs text-neutral-500">
                        {payment.externalRef ?? "No reference"}
                        {payment.reversedAt && " (reversed)"}
                      </span>
                    </div>
                    <span
                      className={
                        payment.reversedAt
                          ? "tabular shrink-0 text-neutral-400 line-through"
                          : "tabular shrink-0 font-semibold text-navy"
                      }
                    >
                      {formatKES(payment.amountMinor)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {/*
            Last on the page, away from everything else, and only for the one
            account that may use it. Removing a pledge takes money off the
            figure the congregation is watching.
          */}
          {can(admin, "pledges.delete") && (
            <PledgeDelete
              pledgeId={pledge.id}
              reference={pledge.reference}
              paidMinorIsZero={pledge.paidMinor === 0n}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function Figure({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <p className="text-sm text-neutral-500">{label}</p>
      <p
        className={
          accent
            ? "tabular mt-1 text-xl font-semibold text-campfire"
            : "tabular mt-1 text-xl font-semibold text-navy"
        }
      >
        {value}
      </p>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="text-right font-medium text-navy">{children}</dd>
    </div>
  );
}
