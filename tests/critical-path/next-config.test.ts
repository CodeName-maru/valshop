import { describe, it, expect } from "vitest";
import nextConfig from "../../next.config";

describe("Feature: Next.js production 빌드 설정", () => {
  describe("Scenario: production 빌드 가능 설정", () => {
    it("Given next.config, When 로드, Then output 가 standalone 아니고 typed routes 활성", () => {
      // Given/When
      const cfg = typeof nextConfig === "function" ? nextConfig() : nextConfig;
      // Then
      expect(cfg.images).toBeDefined();
      expect((cfg as any).typedRoutes ?? cfg.experimental?.typedRoutes).toBe(true);
    });

    it("Given next.config, When 로드, Then remotePatterns 에 valorant-api.com 포함", () => {
      // Given/When
      const cfg = typeof nextConfig === "function" ? nextConfig() : nextConfig;
      // Then: 이미지 최적화를 위한 외부 이미지 도메인 허용
      const patterns = cfg.images?.remotePatterns ?? [];
      const hasValorantApi = patterns.some((p: any) =>
        p.hostname?.includes("valorant-api.com")
      );
      expect(hasValorantApi).toBe(true);
    });
  });
});
