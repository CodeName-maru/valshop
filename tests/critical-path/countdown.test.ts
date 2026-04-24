/**
 * TDD Tests for countdown timer time calculation functions
 * Plan 0004: 상점 갱신 카운트다운 타이머
 */

import { describe, it, expect } from "vitest";
import { secondsUntilNextKstMidnight, formatHms } from "@/lib/time/countdown";

describe("Feature: 상점 갱신 카운트다운", () => {
  describe("Scenario: 다음 00:00 KST 계산", () => {
    it("given_현재가_KST_23시59분00초_when_secondsUntilNextKstMidnight_then_60을_반환", () => {
      // Given: 2026-04-23 23:59:00 KST == 2026-04-23 14:59:00 UTC
      const now = Date.UTC(2026, 3, 23, 14, 59, 0);
      // When
      const remaining = secondsUntilNextKstMidnight(now);
      // Then
      expect(remaining).toBe(60);
    });

    it("given_현재가_정확히_00시00분00초_KST_when_계산_then_86400초_반환", () => {
      // Given: 2026-04-24 00:00:00 KST == 2026-04-23 15:00:00 UTC
      const now = Date.UTC(2026, 3, 23, 15, 0, 0);
      // When
      const remaining = secondsUntilNextKstMidnight(now);
      // Then — 직전 프레임 자정 충돌 방지: "다음" 자정은 24h 뒤
      expect(remaining).toBe(86400);
    });

    it("given_23시59분59초999_when_계산_then_1초_반환_버림처리", () => {
      // Given
      const now = Date.UTC(2026, 3, 23, 14, 59, 59) + 999;
      // When
      const remaining = secondsUntilNextKstMidnight(now);
      // Then: Math.ceil 로 1 반환 (0초 까지 표시 유지)
      expect(remaining).toBe(1);
    });
  });

  describe("Scenario: 초 → HH:MM:SS 포맷", () => {
    it.each([
      [0, "00:00:00"],
      [1, "00:00:01"],
      [59, "00:00:59"],
      [60, "00:01:00"],
      [3600, "01:00:00"],
      [86399, "23:59:59"],
    ])("given_%i초_when_format_then_%s", (input, expected) => {
      expect(formatHms(input)).toBe(expected);
    });
  });

  describe("Scenario: 음수/NaN 방어", () => {
    it("given_음수초_when_format_then_00_00_00_으로_clamp", () => {
      expect(formatHms(-5)).toBe("00:00:00");
      expect(formatHms(Number.NaN)).toBe("00:00:00");
      expect(formatHms(-Infinity)).toBe("00:00:00");
      expect(formatHms(Infinity)).toBe("00:00:00");
    });
  });

  describe("Scenario: 다양한 시간에서의 KST 자정 계산", () => {
    it("given_정오_KST_when_계산_then_12시간_남음", () => {
      // Given: 2026-04-23 12:00:00 KST == 2026-04-23 03:00:00 UTC
      const now = Date.UTC(2026, 3, 23, 3, 0, 0);
      // When
      const remaining = secondsUntilNextKstMidnight(now);
      // Then: 12 hours = 43200 seconds
      expect(remaining).toBe(43200);
    });

    it("given_자정_1초_후_KST_when_계산_then_23시59분59초_남음", () => {
      // Given: 2026-04-24 00:00:01 KST == 2026-04-23 15:00:01 UTC
      const now = Date.UTC(2026, 3, 23, 15, 0, 1);
      // When
      const remaining = secondsUntilNextKstMidnight(now);
      // Then: 23:59:59 = 86399 seconds
      expect(remaining).toBe(86399);
    });
  });
});
