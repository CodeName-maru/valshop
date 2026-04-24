/**
 * Plan 0020 Phase 2: lib/session/store.ts 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { UserTokensRepo, UpsertTokensInput } from "@/lib/supabase/user-tokens-repo";
import type { SessionTokens } from "@/lib/session/types";

// Mock repo factory function
let mockRepo: UserTokensRepo;

// Mock auth-client for reauth
vi.mock("@/lib/riot/auth-client", () => ({
  reauthWithSsid: vi.fn(),
  exchangeEntitlements: vi.fn(),
}));

// Mock supabase admin
vi.mock("@/lib/supabase/admin", () => ({
  createServiceRoleClient: vi.fn(() => ({
    fetch: vi.fn(),
  })),
}));

// Mock user-tokens-repo
vi.mock("@/lib/supabase/user-tokens-repo", () => ({
  createUserTokensRepo: vi.fn(() => mockRepo),
}));

describe("Plan 0020 Phase 2: store.ts", () => {
  // Fix 키 값 (32B = 256bit, base64 인코딩)
  const TOKEN_KEY_FIXTURE = "MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=";
  const PENDING_KEY_FIXTURE = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWY=";

  const originalTokenKey = process.env.TOKEN_ENC_KEY;
  const originalPendingKey = process.env.PENDING_ENC_KEY;

  // Mock fetcher
  const mockFetcher = {
    fetch: vi.fn(),
  };

  beforeEach(async () => {
    // Initialize mockRepo
    mockRepo = {
      listActive: vi.fn(),
      get: vi.fn(),
      markNeedsReauth: vi.fn(),
      upsert: vi.fn(),
      upsertTokens: vi.fn(),
      findBySessionId: vi.fn(),
      deleteBySessionId: vi.fn(),
      deleteByPuuid: vi.fn(),
    };
    process.env.TOKEN_ENC_KEY = TOKEN_KEY_FIXTURE;
    process.env.PENDING_ENC_KEY = PENDING_KEY_FIXTURE;
    const mod = await import("@/lib/session/crypto");
    mod.resetAllKeyCachesForTest();

    vi.clearAllMocks();

    // Default mock implementations
    vi.mocked(mockRepo.findBySessionId).mockResolvedValue(null);
    vi.mocked(mockRepo.upsertTokens).mockResolvedValue({ user_id: "test-puuid" });
    vi.mocked(mockRepo.deleteBySessionId).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    const mod = await import("@/lib/session/crypto");
    mod.resetAllKeyCachesForTest();
    if (originalTokenKey === undefined) delete process.env.TOKEN_ENC_KEY;
    else process.env.TOKEN_ENC_KEY = originalTokenKey;
    if (originalPendingKey === undefined) delete process.env.PENDING_ENC_KEY;
    else process.env.PENDING_ENC_KEY = originalPendingKey;
  });

  it("2-1: given_puuidAndTokens_whenCreateSession_thenUpsertsRowAndReturnsUuid", async () => {
    const { createSessionStore } = await import("@/lib/session/store");
    const store = createSessionStore();

    const puuid = "test-puuid-123";
    const tokens: SessionTokens = {
      accessToken: "test-access-token",
      entitlementsJwt: "test-entitlements-jwt",
      ssid: "test-ssid",
      tdid: "test-tdid",
      region: "kr",
      accessExpiresIn: 3600,
    };

    const result = await store.createSession(puuid, tokens);

    expect(result.sessionId).toMatch(/^[0-9a-f-]{36}$/); // UUID v4 format
    expect(result.maxAge).toBe(1209600); // 14 days
    expect(mockRepo.upsertTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        puuid,
        sessionId: result.sessionId,
      })
    );
  });

  it("2-2: given_existingPuuidRow_whenCreateSessionAgain_thenReplacesRowWithNewSessionId", async () => {
    const { createSessionStore } = await import("@/lib/session/store");
    const store = createSessionStore();

    const puuid = "test-puuid-123";
    const tokens: SessionTokens = {
      accessToken: "test-access-token",
      entitlementsJwt: "test-entitlements-jwt",
      ssid: "test-ssid",
      region: "kr",
      accessExpiresIn: 3600,
    };

    const result1 = await store.createSession(puuid, tokens);
    const result2 = await store.createSession(puuid, tokens);

    // 다른 session_id 발급
    expect(result1.sessionId).not.toBe(result2.sessionId);
  });

  it("2-3: given_unknownSessionId_whenResolve_thenReturnsNull", async () => {
    const { createSessionStore } = await import("@/lib/session/store");
    const store = createSessionStore();

    const result = await store.resolve("unknown-uuid");

    expect(result).toBeNull();
    expect(mockRepo.findBySessionId).toHaveBeenCalledWith("unknown-uuid");
    expect(mockRepo.deleteBySessionId).not.toHaveBeenCalled();
  });

  it("2-4: given_sessionExpiredRow_whenResolve_thenDeletesRowAndReturnsNull", async () => {
    const { createSessionStore } = await import("@/lib/session/store");
    const store = createSessionStore();

    const sessionId = "expired-session-id";

    // Mock row with expired session
    vi.mocked(mockRepo.findBySessionId).mockResolvedValue({
      user_id: "test-user-id",
      puuid: "test-puuid",
      session_id: sessionId,
      session_expires_at: new Date(Date.now() - 1000), // expired
      ssid_enc: "encrypted",
      tdid_enc: null,
      access_token_enc: Buffer.from("encrypted"),
      refresh_token_enc: Buffer.from(""),
      entitlements_jwt_enc: Buffer.from("encrypted"),
      expires_at: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
      needs_reauth: false,
    });

    const result = await store.resolve(sessionId);

    expect(result).toBeNull();
    expect(mockRepo.deleteBySessionId).toHaveBeenCalledWith(sessionId);
  });

  it("2-5: given_freshAccessToken_whenResolve_thenReturnsDecryptedTokensWithoutReauth", async () => {
    const { getTokenKey, encryptWithKey } = await import("@/lib/session/crypto");
    const { createSessionStore } = await import("@/lib/session/store");
    const { reauthWithSsid } = await import("@/lib/riot/auth-client");
    const store = createSessionStore();

    const sessionId = "fresh-session-id";
    const key = await getTokenKey();

    // Mock row with fresh access token
    const row = {
      user_id: "test-user-id",
      puuid: "test-puuid",
      session_id: sessionId,
      session_expires_at: new Date(Date.now() + 1209600000), // 14 days later
      ssid_enc: await encryptWithKey("test-ssid", key),
      tdid_enc: null,
      access_token_enc: Buffer.from(await encryptWithKey("test-access-token", key), "base64"),
      refresh_token_enc: Buffer.from(""),
      entitlements_jwt_enc: Buffer.from(await encryptWithKey("test-entitlements", key), "base64"),
      expires_at: new Date(Date.now() + 600000), // 10 min later (fresh)
      created_at: new Date(),
      updated_at: new Date(),
      needs_reauth: false,
      region: "kr",
    };

    vi.mocked(mockRepo.findBySessionId).mockResolvedValue(row);

    const result = await store.resolve(sessionId);

    expect(result).toEqual({
      puuid: "test-puuid",
      accessToken: "test-access-token",
      entitlementsJwt: "test-entitlements",
      region: "kr",
      accessExpiresAt: expect.any(Number),
    });

    // reauth 미호출
    expect(vi.mocked(reauthWithSsid)).not.toHaveBeenCalled();
    // DB 업데이트 없음
    expect(mockRepo.upsertTokens).not.toHaveBeenCalled();
  });

  it("2-6: given_nearExpiryRow_whenResolveAndReauthSucceeds_thenUpdatesRowAndReturnsFreshTokens", async () => {
    const { getTokenKey, encryptWithKey } = await import("@/lib/session/crypto");
    const { createSessionStore } = await import("@/lib/session/store");
    const { reauthWithSsid, exchangeEntitlements } = await import("@/lib/riot/auth-client");
    const store = createSessionStore();

    const sessionId = "near-expiry-session-id";
    const key = await getTokenKey();

    // Mock row with near-expiry access token (30s)
    const row = {
      user_id: "test-user-id",
      puuid: "test-puuid",
      session_id: sessionId,
      session_expires_at: new Date(Date.now() + 1209600000),
      ssid_enc: await encryptWithKey("test-ssid", key),
      tdid_enc: null,
      access_token_enc: Buffer.from(await encryptWithKey("old-access-token", key), "base64"),
      refresh_token_enc: Buffer.from(""),
      entitlements_jwt_enc: Buffer.from(await encryptWithKey("old-entitlements", key), "base64"),
      expires_at: new Date(Date.now() + 30000), // 30s later (near expiry)
      created_at: new Date(),
      updated_at: new Date(),
      needs_reauth: false,
      region: "kr",
    };

    vi.mocked(mockRepo.findBySessionId).mockResolvedValue(row);

    // Mock reauth success
    vi.mocked(reauthWithSsid).mockResolvedValue({
      kind: "ok",
      accessToken: "new-access-token",
      expiresIn: 3600,
    });
    vi.mocked(exchangeEntitlements).mockResolvedValue("new-entitlements-jwt");

    const result = await store.resolve(sessionId);

    expect(result).toEqual({
      puuid: "test-puuid",
      accessToken: "new-access-token",
      entitlementsJwt: "new-entitlements-jwt",
      region: "kr",
      accessExpiresAt: expect.any(Number),
    });

    // DB 업데이트 호출
    expect(mockRepo.upsertTokens).toHaveBeenCalled();
  });

  it("2-7: given_nearExpiryRow_whenReauthReturnsExpired_thenDeletesRowAndReturnsNull", async () => {
    const { getTokenKey, encryptWithKey } = await import("@/lib/session/crypto");
    const { createSessionStore } = await import("@/lib/session/store");
    const { reauthWithSsid } = await import("@/lib/riot/auth-client");
    const store = createSessionStore();

    const sessionId = "near-expiry-session-id";
    const key = await getTokenKey();

    const row = {
      user_id: "test-user-id",
      puuid: "test-puuid",
      session_id: sessionId,
      session_expires_at: new Date(Date.now() + 1209600000),
      ssid_enc: await encryptWithKey("test-ssid", key),
      tdid_enc: null,
      access_token_enc: Buffer.from(await encryptWithKey("old-access-token", key), "base64"),
      refresh_token_enc: Buffer.from(""),
      entitlements_jwt_enc: Buffer.from(await encryptWithKey("old-entitlements", key), "base64"),
      expires_at: new Date(Date.now() + 30000),
      created_at: new Date(),
      updated_at: new Date(),
      needs_reauth: false,
      region: "kr",
    };

    vi.mocked(mockRepo.findBySessionId).mockResolvedValue(row);

    // Mock reauth expired
    vi.mocked(reauthWithSsid).mockResolvedValue({ kind: "expired" });

    const result = await store.resolve(sessionId);

    expect(result).toBeNull();
    expect(mockRepo.deleteBySessionId).toHaveBeenCalledWith(sessionId);
  });

  it("2-8: given_reauthReturns5xxButAccessStillValid_whenResolve_thenReturnsExistingTokensWithWarn", async () => {
    const { getTokenKey, encryptWithKey } = await import("@/lib/session/crypto");
    const { createSessionStore } = await import("@/lib/session/store");
    const { reauthWithSsid } = await import("@/lib/riot/auth-client");
    const store = createSessionStore();

    const sessionId = "near-expiry-session-id";
    const key = await getTokenKey();

    const row = {
      user_id: "test-user-id",
      puuid: "test-puuid",
      session_id: sessionId,
      session_expires_at: new Date(Date.now() + 1209600000),
      ssid_enc: await encryptWithKey("test-ssid", key),
      tdid_enc: null,
      access_token_enc: Buffer.from(await encryptWithKey("old-access-token", key), "base64"),
      refresh_token_enc: Buffer.from(""),
      entitlements_jwt_enc: Buffer.from(await encryptWithKey("old-entitlements", key), "base64"),
      expires_at: new Date(Date.now() + 45000), // 45s later (expired but > now)
      created_at: new Date(),
      updated_at: new Date(),
      needs_reauth: false,
      region: "kr",
    };

    vi.mocked(mockRepo.findBySessionId).mockResolvedValue(row);

    // Mock reauth upstream
    vi.mocked(reauthWithSsid).mockResolvedValue({ kind: "upstream" });

    const result = await store.resolve(sessionId);

    // optimistic 반환 (null 아님)
    expect(result).toEqual({
      puuid: "test-puuid",
      accessToken: "old-access-token",
      entitlementsJwt: "old-entitlements",
      region: "kr",
      accessExpiresAt: expect.any(Number),
    });

    // DB 업데이트 없음
    expect(mockRepo.upsertTokens).not.toHaveBeenCalled();
  });

  it("2-9: given_reauthReturns5xxAndAccessExpired_whenResolve_thenReturnsNull", async () => {
    const { getTokenKey, encryptWithKey } = await import("@/lib/session/crypto");
    const { createSessionStore } = await import("@/lib/session/store");
    const { reauthWithSsid } = await import("@/lib/riot/auth-client");
    const store = createSessionStore();

    const sessionId = "near-expiry-session-id";
    const key = await getTokenKey();

    const row = {
      user_id: "test-user-id",
      puuid: "test-puuid",
      session_id: sessionId,
      session_expires_at: new Date(Date.now() + 1209600000),
      ssid_enc: await encryptWithKey("test-ssid", key),
      tdid_enc: null,
      access_token_enc: Buffer.from(await encryptWithKey("old-access-token", key), "base64"),
      refresh_token_enc: Buffer.from(""),
      entitlements_jwt_enc: Buffer.from(await encryptWithKey("old-entitlements", key), "base64"),
      expires_at: new Date(Date.now() - 10000), // 10s ago (expired)
      created_at: new Date(),
      updated_at: new Date(),
      needs_reauth: false,
      region: "kr",
    };

    vi.mocked(mockRepo.findBySessionId).mockResolvedValue(row);

    vi.mocked(reauthWithSsid).mockResolvedValue({ kind: "upstream" });

    const result = await store.resolve(sessionId);

    expect(result).toBeNull();
    // row는 유지 (일시장애 가정)
    expect(mockRepo.deleteBySessionId).not.toHaveBeenCalled();
  });

  it("2-10: given_existingSessionId_whenDestroy_thenDeletesRow", async () => {
    const { createSessionStore } = await import("@/lib/session/store");
    const store = createSessionStore();

    const sessionId = "existing-session-id";

    // 첫 번째 호출
    await store.destroy(sessionId);
    expect(mockRepo.deleteBySessionId).toHaveBeenCalledWith(sessionId);

    // 두 번째 호출 (idempotent)
    vi.mocked(mockRepo.deleteBySessionId).mockClear();
    await store.destroy(sessionId);
    expect(mockRepo.deleteBySessionId).toHaveBeenCalledWith(sessionId);
  });

  it("2-11: given_resolveCall_whenLogged_thenOnlyPrefixesAppear", async () => {
    const { getTokenKey, encryptWithKey } = await import("@/lib/session/crypto");
    const { createSessionStore } = await import("@/lib/session/store");
    const store = createSessionStore();

    const sessionId = "fresh-session-id";
    const puuid = "test-puuid-with-long-id";
    const key = await getTokenKey();

    const row = {
      user_id: "test-user-id",
      puuid: puuid,
      session_id: sessionId,
      session_expires_at: new Date(Date.now() + 1209600000),
      ssid_enc: await encryptWithKey("test-ssid", key),
      tdid_enc: null,
      access_token_enc: Buffer.from(await encryptWithKey("test-access-token", key), "base64"),
      refresh_token_enc: Buffer.from(""),
      entitlements_jwt_enc: Buffer.from(await encryptWithKey("test-entitlements", key), "base64"),
      expires_at: new Date(Date.now() + 600000),
      created_at: new Date(),
      updated_at: new Date(),
      needs_reauth: false,
      region: "kr",
    };

    vi.mocked(mockRepo.findBySessionId).mockResolvedValue(row);

    // Console.warn 스파이
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await store.resolve(sessionId);

    // 로그에 전체 uuid/ssid/accessToken 부재 확인
    const logs = warnSpy.mock.calls.map((call) => JSON.stringify(call));
    logs.forEach((log) => {
      expect(log).not.toContain(sessionId); // 전체 session_id 미포함
      expect(log).not.toContain(puuid); // 전체 puuid 미포함
      expect(log).not.toContain("test-ssid"); // ssid 미포함
      expect(log).not.toContain("test-access-token"); // access_token 미포함
    });

    warnSpy.mockRestore();
  });
});
