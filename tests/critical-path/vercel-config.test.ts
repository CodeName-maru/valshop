import { describe, it, expect } from "vitest";
// @ts-ignore - vercel.json is not a module but we'll import it
import vercelConfig from "../../vercel.json";

describe("Feature: Vercel 배포 구성", () => {
  describe("Scenario: Phase 2 cron 활성 (ADR-0009)", () => {
    it("Given Phase 2 vercel.json, When 로드, Then crons 배열에 check-wishlist 항목이 정의되어 있다", () => {
      // Given: repo 에 커밋된 vercel.json (ADR-0009: Hobby 일 1회 cron)
      // When: 파싱
      // Then: cron 은 Phase 2 에서 check-wishlist 엔드포인트로 등록
      const crons = vercelConfig.crons;
      expect(crons.length).toBeGreaterThanOrEqual(1);
      expect(crons[0].path).toBe("/api/cron/check-wishlist");
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
