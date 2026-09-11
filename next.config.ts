import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Lets a page call forbidden() from next/navigation and have the response
    // actually carry a 403. Without it an admin only screen can only render an
    // apology with a 200 on it, which nothing automated can tell from success.
    authInterrupts: true,
  },
  images: {
    // The only remote images on the site are YouTube poster frames for the
    // click to load launch video. Nothing else is allowed through the
    // optimiser.
    remotePatterns: [{ protocol: "https", hostname: "i.ytimg.com" }],
  },

  /**
   * Response headers, on every route.
   *
   * These are cheap and they close things that are otherwise open by default.
   * The framing rule is the one that matters most here: without it any site can
   * put the admin portal in an invisible iframe over its own buttons, and a
   * treasurer who is already signed in clicks approve or delete without ever
   * seeing the screen they clicked on.
   *
   * Applied through the config rather than middleware so they cover every
   * response, including static assets and the ones middleware never sees.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          /*
           * Nothing on this site is meant to be embedded anywhere. DENY rather
           * than SAMEORIGIN, because the app never frames itself: the launch
           * video is the app framing YouTube, which this does not affect.
           */
          { key: "X-Frame-Options", value: "DENY" },

          // A browser must take our word for a content type rather than
          // sniffing one. Stops an uploaded or user named file being coaxed
          // into running as script.
          { key: "X-Content-Type-Options", value: "nosniff" },

          /*
           * A pledge link carries a 22 character token that is the only thing
           * standing between a stranger and somebody's pledge record, so the
           * full URL must never travel to another origin in a Referer header.
           * Same origin navigation keeps the path; anything leaving keeps only
           * the origin, and an https to http downgrade sends nothing.
           */
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

          /*
           * One year, this host only.
           *
           * Deliberately without includeSubDomains. This site is one subdomain
           * of newlifesdanairobi.org, the main church site stays on WordPress,
           * and there are other hosts on that domain this project does not own
           * or deploy. includeSubDomains would force https on all of them from
           * here, and any one with a certificate problem would become
           * unreachable rather than degraded, with no way to undo it from the
           * affected host: browsers cache the directive for the full max-age.
           * Pinning a pledge form must not be able to take a sister site down.
           *
           * Ignored by browsers over plain http, so a localhost run is
           * unaffected.
           */
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000",
          },

          // The form asks for a name, a number and an amount. It has no reason
          // to reach a camera, a microphone or a location, so none is granted.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
