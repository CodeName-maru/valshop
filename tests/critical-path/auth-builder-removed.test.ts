import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

describe("Feature: buildRiotAuthorizeUrl export 제거", () => {
  it("given_auth_ts_삭제_when_auth_client_import_then_buildRiotAuthorizeUrl_부재", async () => {
    // Given: plan 0023 적용 후 (lib/riot/auth.ts 삭제됨)
    // When: lib/riot/auth-client import
    // Then: buildRiotAuthorizeUrl export 되지 않음
    const clientMod = (await import("@/lib/riot/auth-client")) as Record<string, unknown>;
    expect(clientMod.buildRiotAuthorizeUrl).toBeUndefined();
  });

  it("given_plan_0023_적용_when_lib_riot_auth_ts_확인_then_파일_부재", () => {
    // Given: plan 0023 적용 후
    // When: lib/riot/auth.ts 존재 확인
    // Then: 파일이 삭제됨
    const root = resolve(__dirname, "../..");
    expect(existsSync(resolve(root, "lib/riot/auth.ts"))).toBe(false);
  });
});
