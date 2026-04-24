/**
 * Plan 0020 Phase 4: lib/session/pending-jar.ts 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

// Fix 키 값 (32B = 256bit, base64 인코딩)
const TOKEN_KEY_FIXTURE = "MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=";
const PENDING_KEY_FIXTURE = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWY=";

describe("Plan 0020 Phase 4: pending-jar.ts", () => {
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

  it("4-1: given_jarAndUsername_whenEncodeThenDecode_thenReturnsOriginal", async () => {
    const { encodePendingJar, decodePendingJar } = await import("@/lib/session/pending-jar");
    const jar = [
      { name: "asid", value: "xxx" },
      { name: "clid", value: "yyy" },
    ];
    const username = "user@example.com";

    const blob = await encodePendingJar(jar, username);
    const decoded = await decodePendingJar(blob);

    expect(decoded).toEqual({ jar, username });
  });

  it("4-2: given_blobOlderThan10min_whenDecodePendingJar_thenReturnsNull", async () => {
    const { encodePendingJar, decodePendingJar } = await import("@/lib/session/pending-jar");
    const jar = [{ name: "asid", value: "xxx" }];
    const username = "user@example.com";

    // 만료된 blob 생성 (exp 조작)
    const { getPendingKey, encryptWithKey } = await import("@/lib/session/crypto");
    const key = await getPendingKey();
    const payload = {
      jar,
      username,
      exp: Math.floor(Date.now() / 1000) - 100, // 100초 전 만료
    };
    const expiredBlob = await encryptWithKey(JSON.stringify(payload), key);

    const decoded = await decodePendingJar(expiredBlob);

    expect(decoded).toBeNull();
  });

  it("4-3: given_blobEncryptedWithTokenKey_whenDecodePendingJar_thenReturnsNull", async () => {
    const { getTokenKey, encryptWithKey } = await import("@/lib/session/crypto");
    const { decodePendingJar } = await import("@/lib/session/pending-jar");

    // TOKEN_KEY로 암호화
    const tokenKey = await getTokenKey();
    const payload = JSON.stringify({
      jar: [{ name: "asid", value: "xxx" }],
      username: "user@example.com",
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    const wrongBlob = await encryptWithKey(payload, tokenKey);

    // PENDING_KEY로 복호화 시도 → null
    const decoded = await decodePendingJar(wrongBlob);

    expect(decoded).toBeNull();
  });

  it("4-4: given_tamperedBlob_whenDecodePendingJar_thenReturnsNull", async () => {
    const { encodePendingJar, decodePendingJar } = await import("@/lib/session/pending-jar");
    const jar = [{ name: "asid", value: "xxx" }];
    const username = "user@example.com";

    const blob = await encodePendingJar(jar, username);

    // Tamper: base64 디코딩 후 1바이트 변조
    const buffer = Buffer.from(blob, "base64");
    if (buffer.length > 0) {
      const lastIndex = buffer.length - 1;
      buffer[lastIndex] ^= 0xff;
    }
    const tampered = buffer.toString("base64");

    const decoded = await decodePendingJar(tampered);

    expect(decoded).toBeNull();
  });

  it("4-5: given_blobWithoutExp_whenDecodePendingJar_thenReturnsNull", async () => {
    const { getPendingKey, encryptWithKey } = await import("@/lib/session/crypto");
    const { decodePendingJar } = await import("@/lib/session/pending-jar");

    // exp 필드 누락
    const key = await getPendingKey();
    const payload = JSON.stringify({
      jar: [{ name: "asid", value: "xxx" }],
      username: "user@example.com",
    });
    const invalidBlob = await encryptWithKey(payload, key);

    const decoded = await decodePendingJar(invalidBlob);

    expect(decoded).toBeNull();
  });

  it("4-6: given_realisticJar_whenEncodePendingJar_thenBlobUnder4KB", async () => {
    const { encodePendingJar } = await import("@/lib/session/pending-jar");
    const jar = [
      { name: "asid", value: "a".repeat(200) },
      { name: "clid", value: "b".repeat(200) },
      { name: "tdid", value: "c".repeat(200) },
      { name: "ssid", value: "d".repeat(200) },
    ];
    const username = "user@example.com";

    const blob = await encodePendingJar(jar, username);

    // base64 blob 길이 < 4096
    expect(blob.length).toBeLessThan(4096);
  });
});
