import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "valorant-api.com",
      },
      {
        protocol: "https",
        hostname: "media.valorant-api.com",
      },
    ],
  },
};

export default nextConfig;
