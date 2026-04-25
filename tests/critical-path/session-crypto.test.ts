/**
 * Plan 0011 — Phase 1: `lib/session/crypto.ts` 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { SessionPayload } from "@/lib/session/types";

// 32B base64 fixture keys
const KEY_A = Buffer.alloc(32, 0xAA).toString("base64");
const KEY_B = Buffer.alloc(32, 0xBB).toString("base64");

function basePayload(override: Partial<SessionPayload> = {}): SessionPayload {
  return {
    puuid: "puuid-abc-123",
    accessToken: "acc-tok",
    entitlementsJwt: "ent-jwt",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    region: "kr",
    ...override,
  };
}

describe("Plan 0011 Phase 1: lib/session/crypto", () => {
  const originalKey = process.env.TOKEN_ENC_KEY;

  beforeEach(async () => {
    process.env.TOKEN_ENC_KEY = KEY_A;
    const mod = await import("@/lib/session/crypto");
    mod.resetKeyCacheForTest();
  });

  afterEach(async () => {
    const mod = await import("@/lib/session/crypto");
    mod.resetKeyCacheForTest();
    if (originalKey === undefined) {
      delete process.env.TOKEN_ENC_KEY;
    } else {
      process.env.TOKEN_ENC_KEY = originalKey;
    }
  });

  it("given_validKey_whenEncryptThenDecrypt_thenReturnsOriginalPayload", async () => {
    const { encryptSession, decryptSession } = await import("@/lib/session/crypto");
    const payload = basePayload();
    const ct = await encryptSession(payload);
    const round = await decryptSession(ct);
    expect(round).toEqual(payload);
  });

  it("given_wrongKey_whenDecrypt_thenThrows", async () => {
    const mod = await import("@/lib/session/crypto");
    const payload = basePayload();
    const ct = await mod.encryptSession(payload);

    // Swap key
    process.env.TOKEN_ENC_KEY = KEY_B;
    mod.resetKeyCacheForTest();

    await expect(mod.decryptSession(ct)).rejects.toThrow();
  });

  it("given_tamperedCiphertext_whenDecrypt_thenThrows", async () => {
    const { encryptSession, decryptSession } = await import("@/lib/session/crypto");
    const ct = await encryptSession(basePayload());
    const buf = Buffer.from(ct, "base64");
    buf[buf.length - 1] = buf[buf.length - 1]! ^ 0x01;
    const tampered = buf.toString("base64");
    await expect(decryptSession(tampered)).rejects.toThrow();
  });

  it("given_legacyBase64PlaintextCookie_whenDecrypt_thenThrows", async () => {
    const { decryptSession } = await import("@/lib/session/crypto");
    const legacy = Buffer.from(JSON.stringify(basePayload())).toString("base64");
    await expect(decryptSession(legacy)).rejects.toThrow();
  });

  it("given_missingEnvKey_whenGetSessionKey_thenThrowsWithClearMessage", async () => {
    const mod = await import("@/lib/session/crypto");
    delete process.env.TOKEN_ENC_KEY;
    mod.resetKeyCacheForTest();
    await expect(mod.getSessionKey()).rejects.toThrow(/TOKEN_ENC_KEY/);
  });

  it("given_repeatedCalls_whenGetSessionKey_thenReturnsSameCryptoKey", async () => {
    const { getSessionKey } = await import("@/lib/session/crypto");
    const k1 = await getSessionKey();
    const k2 = await getSessionKey();
    expect(k1).toBe(k2);
  });
});
