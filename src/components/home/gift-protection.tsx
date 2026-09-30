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
 *
 * On a phone every tile is one of a pair, the two figures first, and a tile
 * shows only its headline: six explanations in one column made the block
 * taller than a phone screen and a half. The line stays in the markup for a
 * screen reader, and the tile still links to the full pillar.
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
  tall: "max-sm:order-first sm:col-span-2 lg:col-span-1 lg:row-span-2",
  wide: "max-sm:order-first sm:col-span-2",
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
          className="mt-6 grid grid-flow-row-dense grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
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
      className={`bento-tile flex h-full rounded-2xl p-4 sm:p-5 hover:shadow-elevate-lg focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-offset-2 focus-visible:outline-none ${
        tall
          ? "flex-col bg-navy text-white"
          : "border border-navy/10 bg-[#f8f7f5] text-navy"
      } ${wide ? "flex-col sm:flex-row sm:items-center sm:gap-5" : "flex-col"}`}
    >
      {fact.figure ? (
        <span
          aria-hidden
          className={`tabular shrink-0 leading-none font-semibold text-campfire ${
            tall ? "text-5xl sm:text-8xl" : "text-5xl sm:text-6xl"
          }`}
        >
          {fact.figure}
        </span>
      ) : null}

      <span
        className={`flex flex-col ${tall ? "mt-auto pt-3 sm:pt-6" : ""} ${wide ? "mt-auto pt-3 sm:mt-0 sm:pt-0" : ""}`}
      >
        <span className="flex flex-col items-start gap-2 sm:flex-row sm:gap-2.5">
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
                ? "text-base font-semibold text-balance sm:font-display sm:text-xl"
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
          className={`sr-only text-sm leading-relaxed sm:not-sr-only sm:mt-1.5 ${
            tall ? "text-white/75" : "text-neutral-600"
          }`}
        >
          {fact.line}
        </span>
      </span>
    </Link>
  );
}
