import QRCode from "qrcode";

import { db } from "@/db";
import { env } from "@/env";
import { problem, serviceProblem } from "@/lib/api";
import { publicTokenInput } from "@/server/contracts/pledges";
import * as pledges from "@/server/services/pledges";

export const dynamic = "force-dynamic";

/**
 * GET /api/pledges/:publicToken/qr.svg
 *
 * The QR encodes a URL and nothing else. Not the name, not the amount, not the
 * phone number. A QR code is public by nature: people photograph them, print
 * them and forward them, so anything encoded in one is disclosed. The URL
 * resolves server side and shows only what the viewer is entitled to see.
 *
 * The token never changes, so the image is immutable.
 */
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
    const pledge = await pledges.getByPublicToken(db, {
      publicToken: parsed.data.publicToken,
    });

    if (!pledge) {
      return problem(404, "pledge_not_found", "That pledge link is not valid.");
    }

    const target = `${env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")}/p/${parsed.data.publicToken}`;

    const svg = await QRCode.toString(target, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 1,
      width: 512,
      color: { dark: "#052252", light: "#ffffff" },
    });

    return new Response(svg, {
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    return serviceProblem(error);
  }
}
