import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Feature: 구 auth plan DEPRECATED 배너", () => {
  const root = resolve(__dirname, "../..");

  it.each(["0001_RIOT_AUTH_LOGIN_PLAN.md", "0015_LOGIN_BUTTON_WIRING_PLAN.md"])(
    "given_구_plan_%s_when_최상단_확인_then_DEPRECATED_배너_존재",
    (name) => {
      // Given: Phase 3 적용 후
      const content = readFileSync(resolve(root, "docs/plan", name), "utf8");
      // When: 상단 8줄 추출
      const head = content.split("\n").slice(0, 8).join("\n");
      // Then: 배너 매칭
      expect(head).toMatch(/DEPRECATED.*plan\s*0018\s*[~\-–]\s*0023/i);
    },
  );
});
