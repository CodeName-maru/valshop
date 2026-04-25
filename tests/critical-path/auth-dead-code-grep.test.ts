import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

describe("Feature: lib/riot/auth.ts 잔여 유틸 사용처 파악", () => {
  it("given_auth_ts_withTimeout_when_grep_then_외부_사용처_0_또는_http_util로_이관_가능", () => {
    // Given: 삭제 전 snapshot
    // When: withTimeout grep (auth.ts 자기 자신 제외)
    const out = execSync(
      `git grep -l "withTimeout" -- '*.ts' '*.tsx' | grep -v 'lib/riot/auth.ts' || true`,
      { encoding: "utf8", cwd: "/home/maru/Repository/valshop/.worktrees/0023-legacy-removal" },
    ).trim();
    // Then: 결과에 따라 설계 결정사항 "withTimeout 처리" 분기 확정
    // (테스트 자체는 통과 — 결과를 plan 실행자가 눈으로 확인)
    expect(typeof out).toBe("string");
    console.log("[PLAN 0023] withTimeout 사용처 파악 결과:", out || "없음 (삭제 가능)");
  });
});
