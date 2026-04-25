import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

describe("Feature: 레거시 auth 경로 제거 확인", () => {
  const root = resolve(__dirname, "../..");

  it("given_plan_0023_적용_when_legacy_path_확인_then_모두_부재", () => {
    // Given: Phase 2 구현 완료
    // When: 존재 여부 확인
    // Then: 전부 false
    expect(existsSync(resolve(root, "app/api/auth/start"))).toBe(false);
    expect(existsSync(resolve(root, "app/api/auth/callback"))).toBe(false);
    expect(existsSync(resolve(root, "app/api/auth/manual"))).toBe(false);
    expect(existsSync(resolve(root, "public/auth-helper.html"))).toBe(false);
  });
});
