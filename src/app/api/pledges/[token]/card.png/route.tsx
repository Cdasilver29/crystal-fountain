import * as Sentry from "@sentry/nextjs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { db } from "@/db";
import { problem, serviceProblem } from "@/lib/api";
import { CAMPAIGN_SLUG } from "@/lib/campaign";
import { formatKES, formatPercent } from "@/lib/format";
import { publicTokenInput } from "@/server/contracts/pledges";
import { getTotals } from "@/server/services/campaign";
import * as pledges from "@/server/services/pledges";

export const dynamic = "force-dynamic";

/**
 * GET /api/pledges/:publicToken/card.png
 *
 * The link preview WhatsApp draws when somebody forwards their pledge.
 *
 * It carries the reference and the amount and nothing else about the person.
 * No name, no phone number, no email. That is not a new disclosure: /p/<token>
 * and the QR route beside this one already show both to anybody holding the
 * token, and the token is the thing that is unguessable. What makes this
 * different is that a preview card is rendered by the chat app into a group
 * conversation, so anything on it is seen by everybody in that group and not
 * only by the person who opened the link. Hence the reference and the figure,
 * which the pledger is choosing to share, and nothing that identifies them.
 *
 * Built with next/og, which is the Satori runtime Next already compiles in.
 * The layout is flexbox with inline styles because that is the subset Satori
 * implements: no grid, no cascade, and every element that holds more than one
 * child needs an explicit display:flex.
 */

const NAVY = "#052252";
const CAMPFIRE = "#e36520";

/** The progress bar, per the design. 1100px of a 1200px canvas. */
const BAR_WIDTH = 1100;
const BAR_HEIGHT = 20;

/**
 * How long a drawn card may be served before it is drawn again.
 *
 * Deliberately not immutable, unlike the qr.svg route beside this one. That
 * image is immutable because it is a token rendered as squares and a token
 * never changes. This one is not: a pledge grows when somebody adds to it, and
 * the campaign percentage moves every time any pledge is approved. Marking it
 * immutable for a year would pin the first render into the CDN, so a pledger
 * who doubled their pledge would go on sharing the old figure, and two members
 * sharing months apart would send the same stale card into two groups.
 *
 * Five minutes fresh, then an hour in which a stale copy is served while a new
 * one is drawn behind it. The window matters because drawing a card is a wasm
 * render rather than a query, so a forwarded link arriving in a large group
 * should not redraw it once per reader.
 *
 * This governs our own CDN and nothing else. WhatsApp and the rest keep their
 * own copy of a preview image for as long as they choose, so a card already
 * sitting in a conversation will not change. That is the right behaviour: it
 * is a snapshot of what somebody shared on the day they shared it. What this
 * fixes is the next person to share getting a current one.
 */
const CARD_MAX_AGE_SECONDS = 300;
const CARD_STALE_SECONDS = 3600;

/** The typeface the rest of the site is set in. See the README beside them. */
const FONT_DIR = join(process.cwd(), "src", "assets", "fonts");

type CardFonts = NonNullable<
  ConstructorParameters<typeof ImageResponse>[1]
>["fonts"];

/**
 * The two faces, read once per instance rather than once per card.
 *
 * Memoised on the promise rather than on the result, so several cards drawn at
 * the same moment on a cold instance wait on one read instead of racing to
 * start their own.
 *
 * Satori chooses a face from this list by weight and does not interpolate, so
 * bold has to be its own file. Without the 700 entry `fontWeight: 700` below
 * would quietly render as regular, which is exactly what this route did before
 * these fonts existed.
 */
let fonts: Promise<CardFonts> | null = null;

function cardFonts(): Promise<CardFonts> {
  fonts ??= Promise.all([
    readFile(join(FONT_DIR, "Geist-Regular.ttf")),
    readFile(join(FONT_DIR, "Geist-Bold.ttf")),
  ])
    .then(([regular, bold]): CardFonts => [
      // Copied into their own ArrayBuffers. A Buffer from readFile is a view
      // onto a shared pool, and handing Satori the pool rather than the font
      // is a class of bug that only shows up under load.
      { name: "Geist", data: Uint8Array.from(regular).buffer, weight: 400, style: "normal" },
      { name: "Geist", data: Uint8Array.from(bold).buffer, weight: 700, style: "normal" },
    ])
    .catch((error) => {
      /*
       * The files are included in the function bundle by
       * outputFileTracingIncludes in next.config.ts. If that ever stops being
       * true, a card in the wrong typeface is a far better outcome than every
       * WhatsApp preview on the site failing, so this falls back to the font
       * next/og bundles and says so rather than throwing.
       */
      Sentry.captureException(error, {
        tags: { area: "pledge_card_fonts" },
      });
      // Reset, so a transient read failure is retried rather than cached for
      // the life of the instance.
      fonts = null;
      return undefined;
    });

  return fonts;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const parsed = publicTokenInput.safeParse({ publicToken: token });

  if (!parsed.success) {
    return problem(404, "pledge_not_found", "That pledge link is not valid.");
  }

  try {
    /*
     * The pledge and the campaign figures together.
     *
     * getTotals rather than the cached getCampaignTotals: this is read by a
     * link scraper rather than by the congregation refreshing a page, so there
     * is no stampede to protect against, and the card should show the figure
     * that was true when it was drawn.
     */
    const [pledge, totals, typeface] = await Promise.all([
      pledges.getByPublicToken(db, { publicToken: parsed.data.publicToken }),
      getTotals(db, { campaignSlug: CAMPAIGN_SLUG }),
      cardFonts(),
    ]);

    if (!pledge) {
      return problem(404, "pledge_not_found", "That pledge link is not valid.");
    }

    /*
     * The fill width, worked out on the campaign's own percentage.
     *
     * Clamped to the bar: a campaign that passes its target should show a full
     * bar rather than one that runs off the side of the image. This is the one
     * place a total becomes a number, and it is doing so to be a pixel width
     * and not to be money. The figures printed on the card are formatted from
     * the bigints, untouched.
     */
    const percent = Math.max(0, Math.min(100, totals.percentPledged));
    const fillWidth = Math.round((BAR_WIDTH * percent) / 100);

    return new ImageResponse(
      (
        <div
          style={{
            width: "1200px",
            height: "630px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            backgroundColor: NAVY,
            padding: "50px",
            // Inherited by everything below. Ignored harmlessly if the faces
            // failed to load, since Satori falls back to its own font.
            fontFamily: "Geist",
          }}
        >
          {/* Top row: the church on the left, the campaign on the right. */}
          <div
            style={{
              display: "flex",
              width: "100%",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: "26px",
              fontWeight: 400,
              color: "#ffffff",
            }}
          >
            <div style={{ display: "flex" }}>Newlife SDA Church</div>
            <div style={{ display: "flex", color: CAMPFIRE }}>
              Crystal Fountain Development Project
            </div>
          </div>

          {/* The middle, which is what the card is for. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: "52px",
                fontWeight: 700,
                color: CAMPFIRE,
                letterSpacing: "-1px",
              }}
            >
              This is My Pledge
            </div>

            {/* The focal point. Deliberately the largest thing on the card. */}
            <div
              style={{
                display: "flex",
                fontSize: "128px",
                fontWeight: 700,
                color: "#ffffff",
                letterSpacing: "-2px",
                marginTop: "18px",
                lineHeight: 1.1,
              }}
            >
              {pledge.reference}
            </div>

            <div
              style={{
                display: "flex",
                fontSize: "34px",
                fontWeight: 400,
                color: "#ffffff",
                marginTop: "22px",
              }}
            >
              {`${formatKES(pledge.amountMinor)} pledged toward ${formatKES(totals.targetMinor)}`}
            </div>
          </div>

          {/* The campaign as a whole, underneath one person's part in it. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: `${BAR_WIDTH}px`,
            }}
          >
            <div
              style={{
                display: "flex",
                width: `${BAR_WIDTH}px`,
                height: `${BAR_HEIGHT}px`,
                backgroundColor: "#0a1730",
                borderRadius: `${BAR_HEIGHT / 2}px`,
                overflow: "hidden",
              }}
            >
              {/*
                Rendered only when there is something to render. Satori draws a
                zero width box with a border radius as a faint sliver, which
                would read as progress that has not happened.
              */}
              {fillWidth > 0 ? (
                <div
                  style={{
                    display: "flex",
                    width: `${fillWidth}px`,
                    height: `${BAR_HEIGHT}px`,
                    backgroundColor: CAMPFIRE,
                    borderRadius: `${BAR_HEIGHT / 2}px`,
                  }}
                />
              ) : null}
            </div>

            <div
              style={{
                display: "flex",
                width: "100%",
                justifyContent: "flex-end",
                fontSize: "26px",
                fontWeight: 400,
                color: "#ffffff",
                marginTop: "14px",
              }}
            >
              {/* formatPercent, the same one the live tracker prints beside
                  "of goal", so the card and the site agree to the decimal. */}
              {`${formatPercent(percent)} of goal`}
            </div>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
        fonts: typeface,
        headers: {
          "cache-control": `public, max-age=${CARD_MAX_AGE_SECONDS}, stale-while-revalidate=${CARD_STALE_SECONDS}`,
        },
      },
    );
  } catch (error) {
    return serviceProblem(error);
  }
}
