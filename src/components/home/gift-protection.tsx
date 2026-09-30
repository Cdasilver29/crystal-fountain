import { Ban, ClipboardCheck, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";

import { CD_FUND } from "@/content/cd-fund";
import { PROTECTION_FACTS, type ProtectionFact } from "@/content/home";

const ICONS = {
  "ring-fenced": ShieldCheck,
  segregation: Users,
  audit: ClipboardCheck,
  investment: Ban,
} as const;

/*
 * Where each fact sits in the bento from the large breakpoint up, by its place
 * in PROTECTION_FACTS. Four columns and two rows: the three sign-offs stand
 * the full height of the block on the left and the seven years run across two
 * columns, and the rest fill the gaps. Dense packing does the placing, so on
 * two columns the wide tiles take a row each and the small ones pair up.
 */
type Shape = "tall" | "wide" | "small";

const SHAPES: readonly Shape[] = [
  "tall",
  "small",
  "wide",
  "small",
  "small",
  "small",
];

const PLACEMENT: Record<Shape, string> = {
  tall: "sm:col-span-2 lg:col-span-1 lg:row-span-2",
  wide: "sm:col-span-2",
  small: "",
};

/**
 * How your gift is protected.
 *
 * The question a member asks before giving is whether the money is safe, so
 * the answers from the CD-Fund policy come just before how to give. Dense on
 * purpose: one fact to a tile, each linking to the pillar it comes from.
 * Rendered on the server; the icons are inline SVG and there is no script.
 */
export function GiftProtection() {
  return (
    <section
      aria-labelledby="protection-heading"
      className="page-gutter section"
    >
      <div className="container-marketing">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <h2
            id="protection-heading"
            data-reveal=""
            className="font-display text-xl font-semibold text-balance text-navy sm:text-3xl"
          >
            How your gift is protected
          </h2>
          <Link
            href={CD_FUND.href}
            className="rounded text-sm font-medium text-denim underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
          >
            Read the full CD-Fund policy
          </Link>
        </div>

        <ul
          data-reveal=""
          data-stagger=""
          className="mt-6 grid grid-flow-row-dense gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          {PROTECTION_FACTS.map((fact, index) => (
            <li key={fact.headline} className={PLACEMENT[SHAPES[index]]}>
              <Tile fact={fact} shape={SHAPES[index]} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Tile({ fact, shape }: { fact: ProtectionFact; shape: Shape }) {
  const Icon = fact.icon ? ICONS[fact.icon] : null;
  const tall = shape === "tall";
  const wide = shape === "wide";

  return (
    <Link
      href={`${CD_FUND.href}#pillar-${fact.pillar}`}
      className={`bento-tile flex h-full rounded-2xl p-5 hover:shadow-elevate-lg focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-offset-2 focus-visible:outline-none ${
        tall
          ? "flex-col bg-navy text-white"
          : "border border-navy/10 bg-[#f8f7f5] text-navy"
      } ${wide ? "items-center gap-5" : "flex-col"}`}
    >
      {fact.figure ? (
        <span
          aria-hidden
          className={`tabular shrink-0 leading-none font-semibold text-campfire ${
            tall ? "text-7xl sm:text-8xl" : "text-6xl"
          }`}
        >
          {fact.figure}
        </span>
      ) : null}

      <span className={`flex flex-col ${tall ? "mt-auto pt-6" : ""}`}>
        <span className="flex items-start gap-2.5">
          {Icon ? (
            <Icon
              aria-hidden
              strokeWidth={1.75}
              className="mt-0.5 size-5 shrink-0 text-campfire"
            />
          ) : null}
          <span
            className={
              tall
                ? "font-display text-xl font-semibold text-balance"
                : "text-base font-semibold text-balance"
            }
          >
            {/* The figure is hidden, so it is said here as part of the line. */}
            {fact.figure ? (
              <span className="sr-only">{fact.figure} </span>
            ) : null}
            {fact.headline}
          </span>
        </span>
        <span
          className={`mt-1.5 text-sm leading-relaxed ${
            tall ? "text-white/75" : "text-neutral-600"
          }`}
        >
          {fact.line}
        </span>
      </span>
    </Link>
  );
}
