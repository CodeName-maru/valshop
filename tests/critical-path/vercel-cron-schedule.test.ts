/**
 * Plan 0013 Phase 2 Tests — vercel.json cron schedule regression guards
 *
 * Relates to ADR-0009 (cron-daily-hobby-budget): Hobby 플랜이 일 1회 cron 만
 * 허용하므로 sub-daily 표현은 배포 실패를 유발한다. 본 회귀 가드는 schedule drift
 * (예: 실수로 "0 * * * *" 재도입) 를 CI 단계에서 차단한다.
 *
 * Test 2-4 (idempotency) cross-reference:
 *   See tests/critical-path/worker-check-wishlist.test.ts —
 *   "Scenario: 중복 발동 시 중복 메일 방지" 가 Vercel hour-distribution 으로 인한
 *   동일 rotation 중복 발동 대비 idempotency 를 커버한다. ADR-0009 Consequences 가
 *   해당 테스트에 의존한다.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const VERCEL_JSON_PATH = resolve(__dirname, "../../vercel.json");

function loadVercelConfig(): {
  crons: Array<{ path: string; schedule: string }>;
} {
  return JSON.parse(readFileSync(VERCEL_JSON_PATH, "utf8"));
}

describe("Feature: vercel.json cron schedule — Hobby budget", () => {
  describe("Scenario: schedule 파싱 (Test 2-1)", () => {
    it("given vercel.json, when crons[0].schedule 읽기, then 일 1회 cron 표현이어야", () => {
      // Given
      const config = loadVercelConfig();
      const schedule = config.crons[0].schedule;
      // When
      const fields = schedule.trim().split(/\s+/);
      // Then: 5-field cron, minute/hour 고정(숫자), day-of-month/month/day-of-week = "*"
      expect(fields).toHaveLength(5);
      const [min, hour, dom, mon, dow] = fields;
      expect(min).toMatch(/^\d+$/);
      expect(hour).toMatch(/^\d+$/);
      expect(dom).toBe("*");
      expect(mon).toBe("*");
      expect(dow).toBe("*");
    });
  });

  describe("Scenario: 스케줄이 KST 로테이션 window 내 발동 (Test 2-2)", () => {
    it("given UTC schedule, when KST 변환, then 00:00~00:59 범위", () => {
      // Given
      const config = loadVercelConfig();
      const [min, hour] = config.crons[0].schedule.split(/\s+/);
      // When
      const utcHour = Number(hour);
      const kstHour = (utcHour + 9) % 24;
      // Then
      expect(kstHour).toBe(0); // 로테이션 직후 hour
      expect(Number(min)).toBeGreaterThanOrEqual(0);
      expect(Number(min)).toBeLessThanOrEqual(30); // 로테이션 후 30분 이내 권장
    });
  });

  describe("Scenario: 경로 보존 (Test 2-3)", () => {
    it("given vercel.json, when crons[0].path 읽기, then 기존 엔드포인트 유지", () => {
      const config = loadVercelConfig();
      expect(config.crons[0].path).toBe("/api/cron/check-wishlist");
    });
  });
});
