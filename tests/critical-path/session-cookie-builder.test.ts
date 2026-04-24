/**
 * Plan 0011 — Phase 2: buildSessionCookie 암호화 배선 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { SessionPayload } from "@/lib/session/types";

const KEY = Buffer.alloc(32, 0x11).toString("base64");

function payload(over: Partial<SessionPayload> = {}): SessionPayload {
  return {
    puuid: "abc-123",
    accessToken: "access-token-value",
    entitlementsJwt: "entitlement-jwt-value",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    region: "kr",
    ...over,
  };
}

describe("Plan 0011 Phase 2: buildSessionCookie", () => {
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

  it("given_validPayload_whenBuildSessionCookie_thenIncludesSecurityAttributes", async () => {
    const { buildSessionCookie } = await import("@/lib/session/cookie");
    const header = await buildSessionCookie(payload());
    expect(header).toMatch(/^session=/);
    expect(header).toMatch(/HttpOnly/);
    expect(header).toMatch(/Secure/);
    expect(header).toMatch(/SameSite=Lax/);
    expect(header).toMatch(/Path=\//);
    expect(header).toMatch(/Max-Age=\d+/);
  });

  it("given_payload_whenBuildSessionCookie_thenValueDoesNotContainPlaintextPuuid", async () => {
    const { buildSessionCookie } = await import("@/lib/session/cookie");
    const header = await buildSessionCookie(payload({ puuid: "plaintext-unique-puuid-xyz" }));
    expect(header).not.toContain("plaintext-unique-puuid-xyz");
    expect(header).not.toContain("access-token-value");
  });

  it("given_expiredPayload_whenBuildSessionCookie_thenMaxAgeIsZero", async () => {
    const { buildSessionCookie } = await import("@/lib/session/cookie");
    const header = await buildSessionCookie(payload({ expiresAt: Math.floor(Date.now() / 1000) - 100 }));
    expect(header).toMatch(/Max-Age=0/);
  });

  it("given_realisticPayload_whenBuildSessionCookie_thenUnder4KB", async () => {
    const { buildSessionCookie } = await import("@/lib/session/cookie");
    const big: SessionPayload = {
      puuid: "p".repeat(64),
      accessToken: "a".repeat(800),
      entitlementsJwt: "e".repeat(800),
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      region: "kr",
    };
    const header = await buildSessionCookie(big);
    expect(header.length).toBeLessThan(4096);
  });
});
