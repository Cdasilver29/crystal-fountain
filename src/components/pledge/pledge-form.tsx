"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  groupDigits,
  formatKES,
  formatNumber,
  formatPhoneForDisplay,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { redemptionSummary } from "@/lib/redemption";
import { normalizeKenyanPhone } from "@/server/contracts/phone";
import {
  createPledgeInput,
  REDEMPTION_CHOICES,
  REDEMPTION_PLANS,
  type PledgeCategory,
  type PledgeTier,
  type RedemptionChoice,
} from "@/server/contracts/pledges";

/**
 * The three step pledge form.
 *
 * Amount first, because deciding the amount is the real decision and everything
 * after it is admin. Steps are local state, not routes, so a member on a slow
 * connection never waits for a navigation between them and never loses what
 * they typed by going back.
 *
 * Validation uses the same Zod contract the route handler uses. This copy is
 * convenience only. The server revalidates everything.
 */

/**
 * The suggested amounts, as two categories of three tiers each.
 *
 * A household deciding together and a member deciding alone are answering
 * different questions, and a single list of chips has to pick one of them to
 * insult. Two tabs let each see figures that make sense for them, with the
 * family tab first and selected by default because the campaign's own
 * commitment table is built around what a household gives over three years.
 *
 * Within a tab the tiers run from largest to smallest, so the first thing read
 * is the most ambitious one on offer. A suggestion is an anchor, and the lowest
 * figure on screen is the one a hesitant member settles on, so the bottom tier
 * is a floor for the suggestions rather than a floor for the pledge: anything
 * at all can be typed into the custom field, down to the contract minimum of
 * KES 100.
 *
 * The tier keys are the ones the contract stores on each increment, so what the
 * form calls a tier and what analytics later counts as one are the same thing.
 */
export type Tier = {
  key: PledgeTier;
  /** The heading. What choosing this tier means. */
  label: string;
  /** The range it covers, read underneath the label. */
  range: string;
  amounts: number[];
  /**
   * Whether to give this tier the gold treatment. Only the family landmark
   * tier has it: making every top tier look special would make none of them.
   */
  premium?: boolean;
};

export const CATEGORY_TIERS: Record<PledgeCategory, Tier[]> = {
  family: [
    {
      key: "family_above_10m",
      label: "Landmark commitment",
      range: "Above KES 10 million",
      amounts: [10_000_000, 15_000_000, 20_000_000, 50_000_000],
      premium: true,
    },
    {
      key: "family_1m_to_10m",
      label: "Family pledge over 3 years",
      range: "KES 1 million to 10 million",
      amounts: [1_000_000, 2_000_000, 3_000_000, 5_000_000, 7_000_000],
    },
    {
      key: "family_below_1m",
      label: "Every contribution counts",
      range: "Below KES 1 million",
      amounts: [100_000, 250_000, 500_000, 750_000],
    },
  ],
  individual: [
    {
      key: "individual_above_1m",
      label: "Lead the way",
      range: "Above KES 1 million",
      amounts: [1_000_000, 2_000_000, 5_000_000],
    },
    {
      key: "individual_100k_to_1m",
      label: "Individual commitment",
      range: "KES 100,000 to 1 million",
      amounts: [100_000, 250_000, 500_000, 750_000],
    },
    {
      key: "individual_below_100k",
      label: "Start your journey",
      range: "Below KES 100,000",
      amounts: [10_000, 25_000, 50_000, 75_000],
    },
  ],
};

export const CATEGORY_LABELS: Record<PledgeCategory, string> = {
  family: "Family / group pledge",
  individual: "Individual pledge",
};

/** Digits the amount field accepts, enough for the KES 1,000,000,000 ceiling. */
const MAX_AMOUNT_DIGITS = 10;

const STEP_LABELS = ["Amount", "Your details", "Review"] as const;

type Errors = Record<string, string>;

export type PledgeFormProps = {
  /**
   * The Turnstile site key, or null when Turnstile is not configured.
   *
   * Passed down from the page, which is a server component, rather than read
   * from a NEXT_PUBLIC_ variable. The key is not secret and ends up in the
   * markup either way; handing it over as a prop keeps the environment variable
   * named the way Cloudflare names it and keeps the widget out of the bundle
   * when there is no key to render it with.
   */
  turnstileSiteKey?: string | null;
};

export function PledgeForm({ turnstileSiteKey = null }: PledgeFormProps) {
  const router = useRouter();

  const [step, setStep] = useState(0);
  // Which way the last move went, so the incoming step enters from the side it
  // came from. Reset on every move, never read for anything but the animation.
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [amountDigits, setAmountDigits] = useState("");
  // Which tab is open. Family first, because that is the decision the campaign
  // is really asking a household to make.
  const [category, setCategory] = useState<PledgeCategory>("family");
  const [redemption, setRedemption] = useState<RedemptionChoice>("one_off");
  // Which chip is pressed, or null when the amount was typed. Several tiers
  // share a value, 1,000,000 and 100,000 among them, so the tier is part of the
  // identity and a value alone cannot say which chip is lit.
  const [chosen, setChosen] = useState<{
    tier: PledgeTier;
    amount: number;
  } | null>(null);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [membershipNo, setMembershipNo] = useState("");
  const [recordConsent, setRecordConsent] = useState(false);
  const [contactConsent, setContactConsent] = useState(false);
  const [displayConsent, setDisplayConsent] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  // The Turnstile token, and the widget itself so a spent one can be replaced.
  // A token is single use: once the server has redeemed it, a retry with the
  // same one is refused, so every failed submission asks for a fresh one.
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance | null>(null);

  const needsTurnstile = Boolean(turnstileSiteKey);

  function freshTurnstileToken() {
    setTurnstileToken(null);
    turnstileRef.current?.reset();
  }

  const headingRef = useRef<HTMLHeadingElement>(null);

  function chooseAmount(tier: PledgeTier, amount: number) {
    setAmountDigits(String(amount));
    setChosen({ tier, amount });
  }

  function typeAmount(digits: string) {
    setAmountDigits(digits);
    setChosen(null);
  }

  /*
   * Switching tabs drops the pressed chip but keeps the amount.
   *
   * Somebody who taps 1,000,000 on the family tab and then looks at the
   * individual one has not changed their mind about the figure, so throwing it
   * away would be rude. The chip cannot stay lit, though: it belongs to a tier
   * that is no longer on screen. The amount then counts as custom, which is
   * what it has become.
   */
  function chooseCategory(next: PledgeCategory) {
    setCategory(next);
    setChosen(null);
  }

  const amountKes = amountDigits === "" ? Number.NaN : Number(amountDigits);

  /*
   * The instalment sentence, or null when there is nothing to divide.
   *
   * Built from the digits as a bigint rather than from amountKes, so the
   * arithmetic behind the figure a member reads is the same integer arithmetic
   * the server does, per CLAUDE.md. The server recomputes it from the pledge
   * total anyway, which under accumulation can be larger than what is on screen
   * here.
   */
  const breakdown =
    amountDigits === ""
      ? null
      : redemptionSummary(BigInt(amountDigits) * 100n, redemption);

  const payload = {
    fullName,
    phone,
    email,
    membershipNo,
    amountKes,
    /*
     * The frequency is what decides, and the server derives the intent from it
     * rather than trusting this field, so the two can never disagree in the
     * database. It is sent because the contract still carries it.
     */
    intent: (redemption === "one_off" ? "one_off" : "installment") as
      | "one_off"
      | "installment",
    installmentFrequency: redemption === "one_off" ? undefined : redemption,
    // Analytics only. A typed figure carries the tab it was typed on and the
    // tier "custom", because that is exactly what it is.
    category,
    tier: chosen?.tier ?? ("custom" as PledgeTier),
    recordConsent,
    contactConsent,
    displayConsent,
    turnstileToken: turnstileToken ?? undefined,
  };

  function collect(issues: { path: PropertyKey[]; message: string }[]): Errors {
    const next: Errors = {};
    for (const issue of issues) {
      const key = String(issue.path[0] ?? "form");
      if (!next[key]) next[key] = issue.message;
    }
    return next;
  }

  function goTo(nextStep: number) {
    setDirection(nextStep >= step ? "forward" : "back");
    setStep(nextStep);
    setErrors({});
    // Move focus to the new step heading so a screen reader announces it and a
    // keyboard user is not left at the bottom of the page.
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  function next() {
    const fields =
      step === 0
        ? (["amountKes"] as const)
        : ([
            "fullName",
            "phone",
            "email",
            "membershipNo",
            "recordConsent",
            "contactConsent",
            "displayConsent",
          ] as const);

    const shape = Object.fromEntries(fields.map((f) => [f, true]));
    const result = createPledgeInput
      .pick(shape as Record<(typeof fields)[number], true>)
      .safeParse(payload);

    if (!result.success) {
      setErrors(collect(result.error.issues));
      return;
    }

    goTo(step + 1);
  }

  async function submit() {
    const result = createPledgeInput.safeParse(payload);

    if (!result.success) {
      setErrors(collect(result.error.issues));
      return;
    }

    // The server refuses a submission with no token anyway. Catching it here
    // saves a round trip and says something more useful than the refusal would.
    if (needsTurnstile && !turnstileToken) {
      setErrors({
        turnstileToken:
          "Please complete the security check below before submitting.",
      });
      return;
    }

    setSubmitting(true);
    setErrors({});

    try {
      const response = await fetch("/api/pledges", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setErrors(
          body?.errors ?? {
            form:
              body?.title ??
              "We could not record your pledge. Please try again in a moment.",
          },
        );
        // Whatever went wrong, the token that went with it is spent. Without a
        // fresh one the next attempt fails the check rather than the thing the
        // pledger has just corrected.
        freshTurnstileToken();
        setSubmitting(false);
        return;
      }

      router.push(`/pledge/confirmed/${body.publicToken}`);
    } catch {
      setErrors({
        form: "We could not reach the server. Check your connection and try again.",
      });
      setSubmitting(false);
    }
  }

  const normalizedPhone = normalizeKenyanPhone(phone);

  return (
    <div className="mx-auto w-full max-w-lg">
      <StepIndicator step={step} />

      <div className="mt-6 rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:p-7 overflow-x-hidden">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-semibold tracking-tight text-navy outline-none"
        >
          {step === 0 && "How much would you like to pledge?"}
          {step === 1 && "Your details"}
          {step === 2 && "Check this is right"}
        </h2>

        {errors.form && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {errors.form}
          </p>
        )}

        {/*
          Keyed on the step, so React remounts this and the entry animation
          runs again on every move. The card clips horizontally, so a step
          arriving from the side cannot widen the page.
        */}
        <div
          key={step}
          className={direction === "forward" ? "step-in-forward" : "step-in-back"}
        >
        {step === 0 && (
          <div className="mt-5">
            {/*
              Two tabs rather than two headings, because these are alternative
              ways of answering the same question and only one of them applies
              to any given person. Arrow keys move between them, which is what a
              keyboard user expects from a tablist and what a pair of plain
              buttons would not give them.
            */}
            <div
              role="tablist"
              aria-label="Who is making this pledge"
              className="grid grid-cols-2 gap-1 rounded-xl bg-neutral-100 p-1"
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
                  return;
                }
                event.preventDefault();
                chooseCategory(category === "family" ? "individual" : "family");
              }}
            >
              {(Object.keys(CATEGORY_TIERS) as PledgeCategory[]).map((key) => {
                const active = category === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    id={`tab-${key}`}
                    aria-selected={active}
                    aria-controls={`panel-${key}`}
                    tabIndex={active ? 0 : -1}
                    onClick={() => chooseCategory(key)}
                    className={cn(
                      "rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      "focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none",
                      active
                        ? "bg-white text-navy shadow-sm"
                        : "text-neutral-600 hover:text-navy",
                    )}
                  >
                    {CATEGORY_LABELS[key]}
                  </button>
                );
              })}
            </div>

            <div
              role="tabpanel"
              id={`panel-${category}`}
              aria-labelledby={`tab-${category}`}
              className="mt-4 space-y-3"
            >
              {CATEGORY_TIERS[category].map((tier) => (
                <div
                  key={tier.key}
                  className={cn(
                    "rounded-xl border p-4",
                    tier.premium
                      ? "border-campfire/40 bg-campfire/5"
                      : "border-neutral-200 bg-white",
                  )}
                >
                  <h3
                    id={`tier-${tier.key}`}
                    className={cn(
                      "text-base font-semibold",
                      tier.premium ? "text-campfire" : "text-navy",
                    )}
                  >
                    {tier.label}
                  </h3>
                  <p className="mt-0.5 text-sm text-neutral-600">
                    {tier.range}
                  </p>

                  <div
                    role="group"
                    aria-labelledby={`tier-${tier.key}`}
                    className="mt-3 flex flex-wrap gap-2"
                  >
                    {tier.amounts.map((amount) => (
                      <AmountChip
                        key={amount}
                        amount={amount}
                        tierKey={tier.key}
                        premium={Boolean(tier.premium)}
                        selected={
                          chosen?.tier === tier.key && chosen.amount === amount
                        }
                        onSelect={chooseAmount}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/*
              Its own card rather than a line under the chips. Plenty of people
              arrive knowing exactly what they intend to give, and for them the
              suggestions are the thing to skip past; this has to look like a
              way of pledging rather than an escape hatch from one. A chip
              writes into this same field, so whatever is about to be pledged is
              always readable in one place.
            */}
            <div className="mt-5 rounded-xl border-2 border-denim/25 bg-denim/5 p-4">
              <Label htmlFor="amount" className="text-base font-semibold text-navy">
                Create your own pledge
              </Label>
              <p className="mt-0.5 text-sm text-neutral-600">
                Any amount from KES 100 upward.
              </p>

              <div className="mt-3 flex items-baseline gap-2 border-b-2 border-denim/30 pb-2 has-[:focus-visible]:border-campfire">
                <span className="text-2xl font-medium text-neutral-400">
                  KES
                </span>
                <input
                  id="amount"
                  // type="text" with inputMode numeric gives the Android and iOS
                  // numeric keypad while still allowing grouped digits. type
                  // "number" would forbid the separators and add spinners.
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  placeholder="0"
                  aria-describedby={
                    errors.amountKes ? "amount-error" : undefined
                  }
                  aria-invalid={Boolean(errors.amountKes)}
                  value={groupDigits(amountDigits)}
                  onChange={(event) =>
                    typeAmount(
                      event.target.value
                        .replace(/\D/g, "")
                        .slice(0, MAX_AMOUNT_DIGITS),
                    )
                  }
                  className="tabular w-full min-w-0 rounded bg-transparent text-3xl font-semibold tracking-tight text-navy outline-none placeholder:text-neutral-300 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none sm:text-4xl"
                />
              </div>

              {errors.amountKes && (
                <FieldError id="amount-error">{errors.amountKes}</FieldError>
              )}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="mt-5 space-y-5">
            <Field
              id="fullName"
              label="Full name"
              error={errors.fullName}
              required
            >
              <Input
                id="fullName"
                name="name"
                autoComplete="name"
                value={fullName}
                aria-invalid={Boolean(errors.fullName)}
                onChange={(event) => setFullName(event.target.value)}
              />
            </Field>

            <Field
              id="phone"
              label="Phone number"
              error={errors.phone}
              hint="We use this to reach you about your pledge. It is never shown publicly."
              required
            >
              <div className="flex">
                <span
                  aria-hidden
                  className="tabular flex items-center rounded-l-lg border border-r-0 border-neutral-200 bg-neutral-50 px-3 text-sm text-neutral-600"
                >
                  +254
                </span>
                <Input
                  id="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="712 345 678"
                  className="tabular rounded-l-none"
                  value={phone}
                  aria-invalid={Boolean(errors.phone)}
                  onChange={(event) => setPhone(event.target.value)}
                  onBlur={() => {
                    // Settle whatever they typed into the local nine digits, so
                    // the visible prefix and the value agree.
                    const normalized = normalizeKenyanPhone(phone);
                    if (normalized) setPhone(normalized.slice(4));
                  }}
                />
              </div>
            </Field>

            <Field
              id="email"
              label="Email address"
              error={errors.email}
              hint="Optional."
            >
              <Input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                aria-invalid={Boolean(errors.email)}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>

            <Field
              id="membershipNo"
              label="Church membership number"
              error={errors.membershipNo}
              hint="Optional. Leave blank if you are not a member."
            >
              <Input
                id="membershipNo"
                autoComplete="off"
                value={membershipNo}
                aria-invalid={Boolean(errors.membershipNo)}
                onChange={(event) => setMembershipNo(event.target.value)}
              />
            </Field>

            <fieldset className="space-y-3 border-t border-neutral-100 pt-5">
              <legend className="sr-only">Your permissions</legend>

              <p className="text-xs leading-relaxed text-neutral-500">
                How we handle your details is set out in our{" "}
                <Link
                  href="/privacy"
                  className="rounded text-denim underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
                >
                  privacy notice
                </Link>
                .
              </p>

              <Consent
                id="recordConsent"
                checked={recordConsent}
                onChange={setRecordConsent}
                error={errors.recordConsent}
              >
                Record my pledge for the Crystal Fountain Development Project.
              </Consent>

              <Consent
                id="contactConsent"
                checked={contactConsent}
                onChange={setContactConsent}
              >
                You may contact me about this pledge and how to pay it.
              </Consent>

              <Consent
                id="displayConsent"
                checked={displayConsent}
                onChange={setDisplayConsent}
              >
                You may show my first name and pledge amount in the recent
                pledges feed on the website.
              </Consent>
            </fieldset>

            {/*
              After the consents, because it is the last thing to decide and the
              only one of these questions that changes what the pledge says.
              Nothing here is binding: the treasurer records what actually
              arrives, and this is a statement of how somebody means to pay.
            */}
            <div className="border-t border-neutral-100 pt-5">
              <Label htmlFor="redemption">
                How do you plan to redeem your pledge?
              </Label>

              <select
                id="redemption"
                value={redemption}
                onChange={(event) =>
                  setRedemption(event.target.value as RedemptionChoice)
                }
                className="mt-2 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-navy focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
              >
                {REDEMPTION_CHOICES.map((choice) => (
                  <option key={choice} value={choice}>
                    {REDEMPTION_PLANS[choice].label}
                  </option>
                ))}
              </select>

              {/*
                The arithmetic, shown the moment a frequency is picked. A
                member deciding between monthly and quarterly is really asking
                what each one costs them, and making them work it out is how a
                form loses somebody at the last step.
              */}
              {breakdown && (
                <p className="tabular mt-2 rounded-lg bg-denim/5 px-3 py-2 text-sm text-navy">
                  {breakdown}
                </p>
              )}

              <p className="mt-2 text-xs text-neutral-500">
                Over 3 years, matching the campaign commitment table. You can
                pay faster or in different amounts; this is a plan, not a
                schedule you are held to.
              </p>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="mt-5">
            <dl className="divide-y divide-neutral-100 text-sm">
              <Row label="Amount">
                <span className="tabular text-lg font-semibold text-navy">
                  {Number.isFinite(amountKes)
                    ? formatKES(BigInt(amountDigits || "0") * 100n)
                    : "-"}
                </span>
              </Row>
              <Row label="Name">{fullName}</Row>
              <Row label="Phone">
                <span className="tabular">
                  {normalizedPhone
                    ? formatPhoneForDisplay(normalizedPhone)
                    : phone}
                </span>
              </Row>
              {email && <Row label="Email">{email}</Row>}
              {membershipNo && <Row label="Membership">{membershipNo}</Row>}
              <Row label="Pledging as">
                {category === "family" ? "Family or group" : "Individual"}
              </Row>
              <Row label="Redeeming">
                <span className="text-right">
                  {REDEMPTION_PLANS[redemption].label}
                  {breakdown && (
                    <span className="tabular block text-xs text-neutral-500">
                      {breakdown}
                    </span>
                  )}
                </span>
              </Row>
              <Row label="Contact me">{contactConsent ? "Yes" : "No"}</Row>
              <Row label="Show in recent pledges">
                {displayConsent ? "Yes" : "No"}
              </Row>
            </dl>

            <p className="mt-5 rounded-lg bg-navy/5 px-4 py-3 text-sm leading-relaxed text-navy">
              A pledge is a promise to give, not a payment. Nothing is charged
              now. You will get a reference number to use when you pay, and the
              treasurer&rsquo;s receipt is the only receipt.
            </p>

            {/*
              The bot check sits on the review step rather than with the
              details, so the token is as fresh as it can be when the pledge is
              actually submitted. Cloudflare expires one after a few minutes,
              and somebody who solves it, then goes back to change their amount,
              then returns, would otherwise submit a token that has already run
              out.
            */}
            {turnstileSiteKey && (
              <div className="mt-5">
                <Turnstile
                  ref={turnstileRef}
                  siteKey={turnstileSiteKey}
                  onSuccess={(token) => {
                    setTurnstileToken(token);
                    // Clear only this field's error. Anything else the pledger
                    // still has to fix stays on screen.
                    setErrors((current) => {
                      if (!current.turnstileToken) return current;
                      const next = { ...current };
                      delete next.turnstileToken;
                      return next;
                    });
                  }}
                  onExpire={freshTurnstileToken}
                  onError={() => {
                    setTurnstileToken(null);
                    setErrors({
                      turnstileToken:
                        "The security check could not load. Check your connection and try again.",
                    });
                  }}
                  options={{ theme: "light", size: "flexible" }}
                />
                {errors.turnstileToken && (
                  <FieldError id="turnstileToken-error">
                    {errors.turnstileToken}
                  </FieldError>
                )}
              </div>
            )}
          </div>
        )}

        </div>

        <div className="mt-7 flex items-center gap-3">
          {step > 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={() => goTo(step - 1)}
              disabled={submitting}
            >
              Back
            </Button>
          )}

          <Button
            type="button"
            onClick={step === 2 ? submit : next}
            disabled={submitting}
            className="ml-auto min-w-36 bg-campfire text-white hover:bg-campfire/90"
          >
            {step === 2
              ? submitting
                ? "Recording..."
                : "Make a pledge"
              : "Continue"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * One suggested amount.
 *
 * The family tier is the same control a size up: more padding, a heavier
 * numeral and a squarer corner, so the hierarchy is legible without turning the
 * individual tier into something a member has to hunt for. The currency sits in
 * front of every figure, muted, because "KES 5,000,000" is the thing meant to
 * anchor the decision.
 */
function AmountChip({
  amount,
  tierKey,
  premium,
  selected,
  onSelect,
}: {
  amount: number;
  tierKey: PledgeTier;
  /** The landmark tier's chips are larger and gold, matching their card. */
  premium: boolean;
  selected: boolean;
  onSelect: (tier: PledgeTier, amount: number) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(tierKey, amount)}
      className={cn(
        "flex items-baseline justify-center gap-1 border transition-colors",
        "focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none",
        premium ? "rounded-xl px-3.5 py-2.5" : "rounded-full px-3 py-1.5",
        selected
          ? "border-navy bg-navy text-white"
          : premium
            ? "border-campfire/40 bg-white text-navy hover:border-campfire"
            : "border-neutral-200 bg-white text-navy hover:border-denim",
      )}
    >
      <span
        className={cn(
          premium ? "text-[11px]" : "text-[10px]",
          selected ? "text-white/70" : "text-neutral-500",
        )}
      >
        KES
      </span>
      <span
        className={cn(
          "tabular",
          premium ? "text-sm font-semibold sm:text-base" : "text-xs font-medium",
        )}
      >
        {formatNumber(amount)}
      </span>
    </button>
  );
}

function StepIndicator({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Progress through the form">
      {STEP_LABELS.map((label, index) => (
        <li key={label} className="flex flex-1 flex-col gap-1.5">
          <span
            className={cn(
              "h-1 rounded-full transition-colors",
              index <= step ? "bg-campfire" : "bg-neutral-200",
            )}
          />
          <span
            className={cn(
              "text-xs",
              index === step ? "font-medium text-navy" : "text-neutral-500",
            )}
            aria-current={index === step ? "step" : undefined}
          >
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  required,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-sm text-neutral-700">
        {label}
        {!required && <span className="ml-1 text-neutral-400">(optional)</span>}
      </Label>
      <div className="mt-1.5">{children}</div>
      {hint && !error && (
        <p className="mt-1.5 text-xs text-neutral-500">{hint}</p>
      )}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="mt-1.5 text-sm text-red-700">
      {children}
    </p>
  );
}

function Consent({
  id,
  checked,
  onChange,
  error,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-invalid={Boolean(error)}
          className="mt-0.5 size-5 shrink-0 accent-campfire"
        />
        <Label htmlFor={id} className="text-sm leading-relaxed text-neutral-700">
          {children}
        </Label>
      </div>
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="text-right font-medium text-navy">{children}</dd>
    </div>
  );
}
