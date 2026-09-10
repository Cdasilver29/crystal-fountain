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
};

export default nextConfig;
