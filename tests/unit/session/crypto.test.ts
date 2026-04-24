/**
 * Plan 0020 Phase 1: crypto.ts 확장 테스트
 * 이중 키 + null 반환 정규화
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

// Fix 키 값 (32B = 256bit, base64 인코딩)
const TOKEN_KEY_FIXTURE = "MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=";
const PENDING_KEY_FIXTURE = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWY=";

describe("Plan 0020 Phase 1: crypto.ts 이중 키 + null 반환", () => {
  const originalTokenKey = process.env.TOKEN_ENC_KEY;
  const originalPendingKey = process.env.PENDING_ENC_KEY;

  beforeEach(async () => {
    process.env.TOKEN_ENC_KEY = TOKEN_KEY_FIXTURE;
    process.env.PENDING_ENC_KEY = PENDING_KEY_FIXTURE;
    const mod = await import("@/lib/session/crypto");
    mod.resetAllKeyCachesForTest();
  });

  afterEach(async () => {
    const mod = await import("@/lib/session/crypto");
    mod.resetAllKeyCachesForTest();
    if (originalTokenKey === undefined) delete process.env.TOKEN_ENC_KEY;
    else process.env.TOKEN_ENC_KEY = originalTokenKey;
    if (originalPendingKey === undefined) delete process.env.PENDING_ENC_KEY;
    else process.env.PENDING_ENC_KEY = originalPendingKey;
  });

  it("1-1: given_tokenKey_whenEncryptThenDecryptWithSameKey_thenReturnsPlaintext", async () => {
    const { getTokenKey, encryptWithKey, decryptWithKey } = await import("@/lib/session/crypto");
    const key = await getTokenKey();
    const plaintext = "hello world";

    const ciphertext = await encryptWithKey(plaintext, key);
    const decrypted = await decryptWithKey(ciphertext, key);

    expect(decrypted).toBe(plaintext);
  });

  it("1-2: given_pendingKey_whenEncryptThenDecryptWithSameKey_thenReturnsPlaintext", async () => {
    const { getPendingKey, encryptWithKey, decryptWithKey } = await import("@/lib/session/crypto");
    const key = await getPendingKey();
    const plaintext = "pending data";

    const ciphertext = await encryptWithKey(plaintext, key);
    const decrypted = await decryptWithKey(ciphertext, key);

    expect(decrypted).toBe(plaintext);
  });

  it("1-3: given_ciphertextFromTokenKey_whenDecryptWithPendingKey_thenReturnsNull", async () => {
    const { getTokenKey, getPendingKey, encryptWithKey, decryptWithKey } = await import("@/lib/session/crypto");
    const tokenKey = await getTokenKey();
    const pendingKey = await getPendingKey();

    const ciphertext = await encryptWithKey("secret", tokenKey);
    const decrypted = await decryptWithKey(ciphertext, pendingKey);

    // 키 교차 복호화 실패 → null (throw 금지)
    expect(decrypted).toBeNull();
  });

  it("1-4: given_tamperedCiphertext_whenDecryptWithKey_thenReturnsNull", async () => {
    const { getTokenKey, encryptWithKey, decryptWithKey } = await import("@/lib/session/crypto");
    const key = await getTokenKey();
    const ciphertext = await encryptWithKey("original", key);

    // Tamper: base64 디코딩 후 마지막 바이트 flip
    const buffer = Buffer.from(ciphertext, "base64");
    if (buffer.length > 0) {
      const lastIndex = buffer.length - 1;
      buffer[lastIndex] ^= 0xff;
    }
    const tampered = buffer.toString("base64");

    const decrypted = await decryptWithKey(tampered, key);

    // GCM auth tag 실패 → null
    expect(decrypted).toBeNull();
  });

  it("1-5: given_missingTokenEncKey_whenGetTokenKey_thenThrowsConfigError", async () => {
    delete process.env.TOKEN_ENC_KEY;
    const { getTokenKey, resetAllKeyCachesForTest } = await import("@/lib/session/crypto");
    resetAllKeyCachesForTest();

    // 환경변수 부재는 throw (config error vs data error 구분)
    await expect(async () => await getTokenKey()).rejects.toThrow(/TOKEN_ENC_KEY/);
  });

  it("1-6: given_missingPendingEncKey_whenGetPendingKey_thenThrowsConfigError", async () => {
    delete process.env.PENDING_ENC_KEY;
    const { getPendingKey, resetAllKeyCachesForTest } = await import("@/lib/session/crypto");
    resetAllKeyCachesForTest();

    // 환경변수 부재는 throw (config error vs data error 구분)
    await expect(async () => await getPendingKey()).rejects.toThrow(/PENDING_ENC_KEY/);
  });

  it("1-7: given_bothKeysConfigured_whenGetCalledTwice_thenEachKeyCachedIndependently", async () => {
    const { getTokenKey, getPendingKey } = await import("@/lib/session/crypto");

    const key1a = await getTokenKey();
    const key1b = await getTokenKey();
    const key2a = await getPendingKey();
    const key2b = await getPendingKey();

    // 동일 참조 반환 (캐시 확인)
    expect(key1a).toBe(key1b);
    expect(key2a).toBe(key2b);

    // 두 키는 서로 다른 객체
    expect(key1a).not.toBe(key2a);
  });

  it("1-8: given_existingSessionApi_whenEncryptAndDecrypt_thenStillWorksAgainstTokenKey", async () => {
    const { encryptSession, decryptSession } = await import("@/lib/session/crypto");
    const payload = {
      puuid: "test-puuid",
      accessToken: "test-access",
      entitlementsJwt: "test-entitlements",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      region: "kr",
    };

    const ciphertext = await encryptSession(payload);
    const decrypted = await decryptSession(ciphertext);

    expect(decrypted).toEqual(payload);
  });
});
