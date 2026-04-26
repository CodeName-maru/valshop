/**
 * Plan 0011 — Phase 3: readSessionFromCookies + requireSession 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SessionPayload } from "@/lib/session/types";

const KEY = Buffer.alloc(32, 0x22).toString("base64");

function payload(over: Partial<SessionPayload> = {}): SessionPayload {
  return {
    puuid: "puuid-xyz",
    accessToken: "acc",
    entitlementsJwt: "ent",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    region: "kr",
    ...over,
  };
}

async function encrypted(p: SessionPayload): Promise<string> {
  const { encryptSession } = await import("@/lib/session/crypto");
  return encryptSession(p);
}

describe("Plan 0011 Phase 3: readSessionFromCookies", () => {
  const originalKey = process.env.TOKEN_ENC_KEY;

  beforeEach(async () => {
    process.env.TOKEN_ENC_KEY = KEY;
    const mod = await import("@/lib/session/crypto");
    mod.resetKeyCacheForTest();
  });

  afterEach(async () => {
    const mod = await import("@/lib/session/crypto");
    mod.resetKeyCacheForTest();
    if (originalKey === undefined) delete process.env.TOKEN_ENC_KEY;
    else process.env.TOKEN_ENC_KEY = originalKey;
  });

  it("given_encryptedSessionCookie_whenReadSessionFromCookies_thenReturnsUserId", async () => {
    const { readSessionFromCookies } = await import("@/lib/auth/cookie");
    const p = payload({ puuid: "user-abc" });
    const ct = await encrypted(p);
    const header = `other=1; session=${ct}; foo=bar`;
    const result = await readSessionFromCookies(header);
    expect(result).toBe("user-abc");
  });

  it("given_legacyPlaintextCookie_whenReadSessionFromCookies_thenReturnsNull", async () => {
    const { readSessionFromCookies } = await import("@/lib/auth/cookie");
    const legacy = Buffer.from(JSON.stringify({ userId: "x" })).toString("base64");
    const header = `session=${legacy}`;
    const result = await readSessionFromCookies(header);
    expect(result).toBeNull();
  });

  it("given_decryptSucceedsButExpired_whenReadSessionFromCookies_thenReturnsNull", async () => {
    const { readSessionFromCookies } = await import("@/lib/auth/cookie");
    const p = payload({ expiresAt: Math.floor(Date.now() / 1000) - 10 });
    const ct = await encrypted(p);
    const result = await readSessionFromCookies(`session=${ct}`);
    expect(result).toBeNull();
  });

  it("given_tamperedCookie_whenReadSessionFromCookies_thenReturnsNull", async () => {
    const { readSessionFromCookies } = await import("@/lib/auth/cookie");
    const ct = await encrypted(payload());
    const buf = Buffer.from(ct, "base64");
    buf[Math.floor(buf.length / 2)] = (buf[Math.floor(buf.length / 2)] ?? 0) ^ 0x5A;
    const tampered = buf.toString("base64");
    const result = await readSessionFromCookies(`session=${tampered}`);
    expect(result).toBeNull();
  });

  it("given_noCookieHeader_whenReadSessionFromCookies_thenReturnsNull", async () => {
    const { readSessionFromCookies } = await import("@/lib/auth/cookie");
    expect(await readSessionFromCookies(null)).toBeNull();
  });
});

describe("Plan 0011 Phase 3: requireSession (guard)", () => {
  const originalKey = process.env.TOKEN_ENC_KEY;

  beforeEach(async () => {
    process.env.TOKEN_ENC_KEY = KEY;
    const mod = await import("@/lib/session/crypto");
    mod.resetKeyCacheForTest();
    vi.resetModules();
  });

  afterEach(async () => {
    vi.resetModules();
    vi.doUnmock("next/headers");
    const mod = await import("@/lib/session/crypto");
    mod.resetKeyCacheForTest();
    if (originalKey === undefined) delete process.env.TOKEN_ENC_KEY;
    else process.env.TOKEN_ENC_KEY = originalKey;
  });

  async function setCookieMock(value: string | null): Promise<void> {
    vi.doMock("next/headers", () => ({
      cookies: async () => ({
        get: (name: string) => {
          if (name === "session" && value !== null) return { name, value };
          return undefined;
        },
      }),
    }));
  }

  it("given_validEncryptedCookie_whenRequireSession_thenReturnsPayload", async () => {
    const p = payload({ puuid: "ok-user" });
    const ct = await encrypted(p);
    await setCookieMock(ct);
    const { requireSession } = await import("@/lib/session/guard");
    const result = await requireSession();
    expect(result.puuid).toBe("ok-user");
    expect(result.accessToken).toBe(p.accessToken);
  });

  it("given_expiredEncryptedCookie_whenRequireSession_thenThrowsUnauthenticated", async () => {
    const p = payload({ expiresAt: Math.floor(Date.now() / 1000) - 5 });
    const ct = await encrypted(p);
    await setCookieMock(ct);
    const { requireSession } = await import("@/lib/session/guard");
    await expect(requireSession()).rejects.toThrow("UNAUTHENTICATED");
  });

  it("given_legacyPlaintextCookie_whenRequireSession_thenThrowsUnauthenticated", async () => {
    const legacy = Buffer.from(JSON.stringify({ puuid: "x" })).toString("base64");
    await setCookieMock(legacy);
    const { requireSession } = await import("@/lib/session/guard");
    await expect(requireSession()).rejects.toThrow("UNAUTHENTICATED");
  });
});
