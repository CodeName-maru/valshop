/**
 * Next.js Configuration
 * FR-9: 스킨 상세 뷰 - media.valorant-api.com 이미지 최적화 허용
 */

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
        port: "",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
