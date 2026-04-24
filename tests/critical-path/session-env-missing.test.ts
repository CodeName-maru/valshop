/**
 * Plan 0011 — Phase 4: TOKEN_ENC_KEY 부재 런타임 에러 메시지 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { SessionPayload } from "@/lib/session/types";

describe("Plan 0011 Phase 4: TOKEN_ENC_KEY missing", () => {
  const originalKey = process.env.TOKEN_ENC_KEY;

  beforeEach(async () => {
    delete process.env.TOKEN_ENC_KEY;
    const mod = await import("@/lib/session/crypto");
    mod.resetKeyCacheForTest();
  });

  afterEach(async () => {
    const mod = await import("@/lib/session/crypto");
    mod.resetKeyCacheForTest();
    if (originalKey === undefined) delete process.env.TOKEN_ENC_KEY;
    else process.env.TOKEN_ENC_KEY = originalKey;
  });

  it("given_missingTokenEncKey_whenBuildSessionCookie_thenThrowsWithEnvHint", async () => {
    const { buildSessionCookie } = await import("@/lib/session/cookie");
    const payload: SessionPayload = {
      puuid: "x",
      accessToken: "y",
      entitlementsJwt: "z",
      expiresAt: Math.floor(Date.now() / 1000) + 100,
      region: "kr",
    };
    await expect(buildSessionCookie(payload)).rejects.toThrow(/TOKEN_ENC_KEY/);
  });
});
