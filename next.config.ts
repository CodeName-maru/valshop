/**
 * Next.js Configuration
 * FR-9: 스킨 상세 뷰 - media.valorant-api.com 이미지 최적화 허용
 */

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PWA 지원을 위해 typedRoutes 활성
  experimental: {
    typedRoutes: true,
  },

  // 이미지 최적화를 위한 외부 도메인 허용
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "valorant-api.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "media.valorant-api.com",
        pathname: "/**",
      },
    ],
  },

  // 보안 헤더 추가 (Security NFR)
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
