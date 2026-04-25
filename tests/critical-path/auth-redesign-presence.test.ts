import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

describe("Feature: auth redesign 신규 경로 선행 존재 확인", () => {
  const root = resolve(__dirname, "../..");

  it("given_plan_0021_완료_when_route_존재_확인_then_login_mfa_logout_모두_존재", () => {
    // Given: plan 0021 merge 전제
    // When: 신규 route 파일 존재 확인
    // Then: 3개 모두 존재 (하나라도 없으면 본 plan 실행 금지)
    expect(existsSync(resolve(root, "app/api/auth/login/route.ts"))).toBe(true);
    expect(existsSync(resolve(root, "app/api/auth/mfa/route.ts"))).toBe(true);
    expect(existsSync(resolve(root, "app/api/auth/logout/route.ts"))).toBe(true);
  });

  it("given_plan_0019_완료_when_auth_client_존재_확인_then_exchangeEntitlements_이관_완료", async () => {
    // Given: plan 0019 merge 전제
    // When: auth-client.ts import
    // Then: exchangeEntitlements export 존재 (fetchPuuid는 jwt.ts로 이관)
    const mod = await import("@/lib/riot/auth-client");
    expect(typeof mod.exchangeEntitlements).toBe("function");

    // jwt.ts에 extractPuuidFromAccessToken이 있는지 확인
    const jwtMod = await import("@/lib/riot/jwt");
    expect(typeof jwtMod.extractPuuidFromAccessToken).toBe("function");
  });
});
