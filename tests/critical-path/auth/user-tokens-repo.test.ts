/**
 * Test 2-1 ~ 2-7: UserTokensRepo 확장 API 단위 테스트
 * Plan: docs/plan/0018_AUTH_DB_SCHEMA_MIGRATION_PLAN.md L198-275
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createUserTokensRepo } from "@/lib/supabase/user-tokens-repo";
import type { UserTokensRow, UpsertTokensInput } from "@/lib/supabase/types";

describe("UserTokensRepo - Plan 0018 FR-R1 확장 API", () => {
  const mockSupabase = {
    from: vi.fn(),
  };

  const mockUserId = "user-123";
  const mockPuuid = "puuid-abc";
  const mockSessionId = "session-uuid-123";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("upsertTokens", () => {
    const upsertInput: UpsertTokensInput = {
      puuid: mockPuuid,
      sessionId: mockSessionId,
      sessionExpiresAt: new Date("2026-04-25T00:00:00Z"),
      ssidEnc: "encrypted-ssid-base64",
      tdidEnc: null,
      accessTokenEnc: new Uint8Array([1, 2, 3]),
      entitlementsJwtEnc: new Uint8Array([4, 5, 6]),
      accessExpiresAt: new Date("2026-04-25T01:00:00Z"),
    };

    // Test 2-1: happy path — 신규 puuid 삽입
    it("givenEmptyTable_whenUpsertTokens_thenInsertsAndReturnsUserId", async () => {
      const mockData = { user_id: mockUserId };
      const mockSingle = vi.fn().mockResolvedValue({ data: mockData, error: null });
      const mockUpsert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: mockSingle }) });

      mockSupabase.from.mockReturnValue({ upsert: mockUpsert });

      const repo = createUserTokensRepo(mockSupabase as any);
      const result = await repo.upsertTokens(upsertInput);

      expect(result).toEqual({ user_id: mockUserId });
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          puuid: mockPuuid,
          session_id: mockSessionId,
          session_expires_at: "2026-04-25T00:00:00.000Z",
          ssid_enc: "encrypted-ssid-base64",
          tdid_enc: null,
        }),
        { onConflict: "puuid" }
      );
    });

    // Test 2-4: 중복 puuid → 덮어쓰기 (last-write-wins)
    it("givenSamePuuidTwice_whenUpsertTokens_thenLastWriteWins", async () => {
      const mockData = { user_id: mockUserId };
      const mockSingle = vi.fn().mockResolvedValue({ data: mockData, error: null });
      const mockUpsert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: mockSingle }) });

      mockSupabase.from.mockReturnValue({ upsert: mockUpsert });

      const repo = createUserTokensRepo(mockSupabase as any);

      // First call
      await repo.upsertTokens({ ...upsertInput, sessionId: "session-1" });
      // Second call with different session_id
      await repo.upsertTokens({ ...upsertInput, sessionId: "session-2" });

      expect(mockUpsert).toHaveBeenCalledTimes(2);
      // Verify second call has session-2
      const secondCall = mockUpsert.mock.calls[1];
      expect(secondCall[0].session_id).toBe("session-2");
    });

    // Test 2-5: 에러 전파
    it("givenDbError_whenUpsertTokens_thenThrowsWithMessage", async () => {
      const mockError = new Error("Connection lost");
      const mockUpsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null, error: mockError }) }),
      });

      mockSupabase.from.mockReturnValue({ upsert: mockUpsert });

      const repo = createUserTokensRepo(mockSupabase as any);

      await expect(repo.upsertTokens(upsertInput)).rejects.toThrow(/Failed to upsert.*Connection lost/);
    });
  });

  describe("findBySessionId", () => {
    const mockRow: UserTokensRow = {
      user_id: mockUserId,
      puuid: mockPuuid,
      session_id: mockSessionId,
      session_expires_at: new Date("2026-04-25T00:00:00Z"),
      ssid_enc: "encrypted-ssid",
      tdid_enc: null,
      access_token_enc: new Uint8Array([1, 2, 3]),
      refresh_token_enc: new Uint8Array([4, 5, 6]),
      entitlements_jwt_enc: new Uint8Array([7, 8, 9]),
      expires_at: new Date("2026-04-25T01:00:00Z"),
      needs_reauth: false,
      created_at: new Date("2026-04-24T00:00:00Z"),
      updated_at: new Date("2026-04-24T00:00:00Z"),
    };

    // Test 2-2: happy path
    it("givenExistingSessionId_whenFindBySessionId_thenReturnsRow", async () => {
      const mockSingle = vi.fn().mockResolvedValue({ data: mockRow, error: null });
      const mockSelect = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: mockSingle }) });

      mockSupabase.from.mockReturnValue({ select: mockSelect });

      const repo = createUserTokensRepo(mockSupabase as any);
      const result = await repo.findBySessionId(mockSessionId);

      expect(result).toEqual(mockRow);
      expect(mockSelect).toHaveBeenCalledWith("*");
    });

    // Test 2-3: not found → null
    it("givenUnknownSessionId_whenFindBySessionId_thenNull", async () => {
      const mockError = { code: "PGRST116", message: "Not found" };
      const mockSingle = vi.fn().mockResolvedValue({ data: null, error: mockError });
      const mockSelect = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: mockSingle }) });

      mockSupabase.from.mockReturnValue({ select: mockSelect });

      const repo = createUserTokensRepo(mockSupabase as any);
      const result = await repo.findBySessionId("unknown-session");

      expect(result).toBeNull();
    });

    // Test 2-5 (findBySessionId): DB 에러 전파
    it("givenDbError_whenFindBySessionId_thenThrowsWithMessage", async () => {
      const mockError = { code: "XX000", message: "Connection lost" };
      const mockSingle = vi.fn().mockResolvedValue({ data: null, error: mockError });
      const mockSelect = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: mockSingle }) });

      mockSupabase.from.mockReturnValue({ select: mockSelect });

      const repo = createUserTokensRepo(mockSupabase as any);

      await expect(repo.findBySessionId(mockSessionId)).rejects.toThrow(/Failed to find.*Connection lost/);
    });
  });

  describe("deleteBySessionId", () => {
    // Test 2-6: 멱등성 — 없는 id 도 성공
    it("givenUnknownSessionId_whenDeleteBySessionId_thenResolvesWithoutError", async () => {
      const mockError = { count: 0, code: "PGRST116", message: "Not found" };
      const mockDelete = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: mockError, count: 0 }) });

      mockSupabase.from.mockReturnValue({ delete: mockDelete });

      const repo = createUserTokensRepo(mockSupabase as any);

      await expect(repo.deleteBySessionId("unknown-session")).resolves.not.toThrow();
    });

    it("givenExistingSessionId_whenDeleteBySessionId_thenResolves", async () => {
      const mockDelete = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null, count: 1 }) });

      mockSupabase.from.mockReturnValue({ delete: mockDelete });

      const repo = createUserTokensRepo(mockSupabase as any);

      await expect(repo.deleteBySessionId(mockSessionId)).resolves.not.toThrow();
    });

    it("givenDbError_whenDeleteBySessionId_thenThrows", async () => {
      const mockError = { code: "XX000", message: "DB error" };
      const mockDelete = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: mockError }) });

      mockSupabase.from.mockReturnValue({ delete: mockDelete });

      const repo = createUserTokensRepo(mockSupabase as any);

      await expect(repo.deleteBySessionId(mockSessionId)).rejects.toThrow(/Failed to delete.*DB error/);
    });
  });

  describe("deleteByPuuid", () => {
    // Test 2-7: 성공 + 에러 전파
    it("givenPuuid_whenDeleteByPuuid_thenDeletesAndResolves", async () => {
      const mockDelete = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null, count: 1 }) });

      mockSupabase.from.mockReturnValue({ delete: mockDelete });

      const repo = createUserTokensRepo(mockSupabase as any);

      await expect(repo.deleteByPuuid(mockPuuid)).resolves.not.toThrow();
    });

    it("givenDbError_whenDeleteByPuuid_thenThrows", async () => {
      const mockError = { code: "XX000", message: "Connection lost" };
      const mockDelete = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: mockError }) });

      mockSupabase.from.mockReturnValue({ delete: mockDelete });

      const repo = createUserTokensRepo(mockSupabase as any);

      await expect(repo.deleteByPuuid(mockPuuid)).rejects.toThrow(/Failed to delete.*Connection lost/);
    });
  });
});
