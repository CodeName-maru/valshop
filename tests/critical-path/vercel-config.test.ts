import { describe, it, expect } from "vitest";
// @ts-ignore - vercel.json is not a module but we'll import it
import vercelConfig from "../../vercel.json";

describe("Feature: Vercel 배포 구성", () => {
  describe("Scenario: MVP 단계에서 cron 비활성", () => {
    it("Given MVP vercel.json, When 로드, Then crons 키가 없거나 빈 배열이다", () => {
      // Given: repo 에 커밋된 vercel.json
      // When: 파싱
      // Then: cron 은 Phase 2 에서만 정의
      expect(vercelConfig.crons ?? []).toEqual([]);
    });

    it("Given vercel.json, When 로드, Then framework 이 nextjs 이다", () => {
      // Given/When
      // Then: Vercel Next.js framework 설정
      expect(vercelConfig.framework).toBe("nextjs");
    });

    it("Given vercel.json, When 로드, Then regions 에 icn1 (한국 리전) 이 포함된다", () => {
      // Given/When
      // Then: 한국 리전 사용으로 latency 최소화
      expect(vercelConfig.regions).toContain("icn1");
    });
  });
});
