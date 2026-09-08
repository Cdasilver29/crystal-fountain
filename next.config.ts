import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // The only remote images on the site are YouTube poster frames for the
    // click to load launch video. Nothing else is allowed through the
    // optimiser.
    remotePatterns: [{ protocol: "https", hostname: "i.ytimg.com" }],
  },
};

export default nextConfig;
