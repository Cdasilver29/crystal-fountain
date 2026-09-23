import * as Sentry from "@sentry/nextjs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { serviceProblem } from "@/lib/api";
import { getCampaignTotals } from "@/lib/campaign";
import { formatKES, formatKESCompact, formatPercent } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * GET /api/og/default.png
 *
 * The link preview for every page that does not draw a card of its own.
 *
 * It replaced the campaign flyer, a 1600 by 1600 square. WhatsApp and Facebook
 * crop a square preview down to a wide strip through its middle, and WhatsApp
 * is where nearly every visitor arrives from, so the first thing most of the
 * congregation saw of the site was the middle third of a poster. This is drawn
 * at 1200 by 630, the shape those apps actually show.
 *
 * Built the same way as the pledge share card beside it in
 * api/pledges/[token]/card.png: next/og, flexbox with inline styles, Geist read
 * from src/assets/fonts. Aggregates only. Nothing on it belongs to any one
 * person.
 */

const NAVY = "#052252";
const CAMPFIRE = "#e36520";

const BAR_WIDTH = 1080;
const BAR_HEIGHT = 20;

/**
 * Five minutes fresh, then an hour served stale while a new one is drawn.
 *
 * The same window as the share card and for the same reason: the figures move,
 * so it must not be immutable, and drawing it is a wasm render, so a link
 * forwarded into a large group should not redraw it once per preview.
 */
const CARD_MAX_AGE_SECONDS = 300;
const CARD_STALE_SECONDS = 3600;

const FONT_DIR = join(process.cwd(), "src", "assets", "fonts");

type CardFonts = NonNullable<
  ConstructorParameters<typeof ImageResponse>[1]
>["fonts"];

let fonts: Promise<CardFonts> | null = null;

/** Read once per instance. See the share card route for why each step is so. */
function cardFonts(): Promise<CardFonts> {
  fonts ??= Promise.all([
    readFile(join(FONT_DIR, "Geist-Regular.ttf")),
    readFile(join(FONT_DIR, "Geist-Bold.ttf")),
  ])
    .then(([regular, bold]): CardFonts => [
      { name: "Geist", data: Uint8Array.from(regular).buffer, weight: 400, style: "normal" },
      { name: "Geist", data: Uint8Array.from(bold).buffer, weight: 700, style: "normal" },
    ])
    .catch((error) => {
      Sentry.captureException(error, { tags: { area: "default_og_fonts" } });
      fonts = null;
      return undefined;
    });

  return fonts;
}

export async function GET() {
  try {
    /*
     * The cached totals rather than a fresh read. Every page on the site points
     * at this one image, so it is fetched far more often than any one pledge's
     * card, and the 30 second cache is the same one the tracker reads.
     */
    const [totals, typeface] = await Promise.all([
      getCampaignTotals(),
      cardFonts(),
    ]);

    // A pixel width, not money. The figures printed are formatted from the
    // minor unit strings, untouched.
    const percent = Math.max(0, Math.min(100, totals.percentPledged));
    const fillWidth = Math.round((BAR_WIDTH * percent) / 100);

    // "KES 550M" as the flyer writes it, the same trim the commitment guide
    // uses, rather than "KES 550.0M".
    const target = formatKESCompact(totals.targetMinor).replace(
      /\.0([KMB])$/,
      "$1",
    );

    return new ImageResponse(
      (
        <div
          style={{
            width: "1200px",
            height: "630px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            alignItems: "center",
            backgroundColor: NAVY,
            padding: "60px",
            fontFamily: "Geist",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              marginTop: "40px",
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: "108px",
                fontWeight: 700,
                color: CAMPFIRE,
                letterSpacing: "-2px",
                lineHeight: 1.05,
              }}
            >
              This is My Pledge
            </div>

            <div
              style={{
                display: "flex",
                fontSize: "46px",
                fontWeight: 700,
                color: "#ffffff",
                marginTop: "22px",
                letterSpacing: "-0.5px",
              }}
            >
              Crystal Fountain Development Project
            </div>

            <div
              style={{
                display: "flex",
                fontSize: "28px",
                fontWeight: 400,
                color: "rgba(255, 255, 255, 0.6)",
                marginTop: "14px",
              }}
            >
              Newlife SDA Church, Nairobi
            </div>
          </div>

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
              {/* No zero width box: Satori draws it as a faint sliver. */}
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
                justifyContent: "space-between",
                alignItems: "baseline",
                fontSize: "30px",
                color: "#ffffff",
                marginTop: "16px",
              }}
            >
              <div style={{ display: "flex", fontWeight: 700 }}>
                {`${formatKES(totals.pledgedMinor)} pledged toward ${target}`}
              </div>
              <div
                style={{
                  display: "flex",
                  fontWeight: 400,
                  color: "rgba(255, 255, 255, 0.7)",
                }}
              >
                {`${formatPercent(percent)} of goal`}
              </div>
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
