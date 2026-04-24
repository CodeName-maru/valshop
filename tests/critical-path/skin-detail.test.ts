import { describe, it, expect, vi, beforeEach } from "vitest";
import { getSkinDetail } from "@/lib/valorant-api/catalog";
import type { SkinDetail, Chroma, SkinLevel } from "@/lib/domain/skin";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("Feature: 스킨 상세 조회 — Phase 1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Test 1-1: 카탈로그에서 단건 스킨 상세를 가져온다", () => {
    it("givenValidUuid_whenGetSkinDetail_thenReturnsSkinWithChromasAndLevels", async () => {
      // Given: MSW 가 valorant-api.com/v1/weapons/skins/{uuid} 를 모킹
      const mockUuid = "9fb348bc-41a0-91ad-8a3e-818035c4e561";
      const mockResponse = {
        data: {
          uuid: mockUuid,
          displayName: "Prime 2.0",
          displayIcon: "https://media.valorant-api.com/skins/9fb348bc-41a0-91ad-8a3e-818035c4e561/displayicon.png",
          contentTierUuid: "605ca61b-4e7f-ce3f-ec92-9bfc2e65999d",
          chromas: [
            {
              uuid: "chroma-1",
              displayName: "Base",
              fullRender: "https://media.valorant-api.com/skins/chroma-1/fullrender.png",
              swatch: null,
            },
            {
              uuid: "chroma-2",
              displayName: "Gold",
              fullRender: "https://media.valorant-api.com/skins/chroma-2/fullrender.png",
              swatch: null,
            },
            {
              uuid: "chroma-3",
              displayName: "Silver",
              fullRender: "https://media.valorant-api.com/skins/chroma-3/fullrender.png",
              swatch: null,
            },
          ],
          levels: [
            {
              uuid: "level-1",
              displayName: "Level 1",
              displayIcon: "https://media.valorant-api.com/skins/level-1/icon.png",
              streamedVideo: null,
            },
            {
              uuid: "level-2",
              displayName: "Level 2",
              displayIcon: "https://media.valorant-api.com/skins/level-2/icon.png",
              streamedVideo: null,
            },
          ],
          streamedVideo: "https://youtu.be/abc123",
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      // When: getSkinDetail(uuid) 호출
      const result = await getSkinDetail(mockUuid);

      // Then: SkinDetail 타입으로 매핑되어 chromas.length === 3, levels.length === 2
      expect(result).not.toBeNull();
      expect(result?.uuid).toBe(mockUuid);
      expect(result?.displayName).toBe("Prime 2.0");
      expect(result?.chromas.length).toBe(3);
      expect(result?.levels.length).toBe(2);
      expect(result?.streamedVideo).toBe("https://youtu.be/abc123");
    });
  });

  describe("Test 1-2: ISR 캐시 옵션이 ADR-0003 과 동일하다 (Cost NFR)", () => {
    it("givenGetSkinDetailCall_whenFetchInvoked_thenUsesRevalidate86400", async () => {
      // Given: fetch spy
      const mockUuid = "9fb348bc-41a0-91ad-8a3e-818035c4e561";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: null }),
      } as Response);

      // When: getSkinDetail(uuid)
      await getSkinDetail(mockUuid);

      // Then: fetch 가 { next: { revalidate: 86400 } } 옵션으로 호출된다
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("valorant-api.com"),
        expect.objectContaining({
          next: expect.objectContaining({
            revalidate: 86400,
          }),
        })
      );
    });
  });

  describe("Test 1-3: 존재하지 않는 UUID 에 대해 null 을 반환한다", () => {
    it("givenUnknownUuid_whenGetSkinDetail_thenReturnsNull", async () => {
      // Given: MSW 가 404 응답
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response);

      // When: getSkinDetail("00000000-…")
      const result = await getSkinDetail("00000000-0000-0000-0000-000000000000");

      // Then: null 반환 (페이지 레이어에서 notFound() 변환)
      expect(result).toBeNull();
    });
  });

  describe("추가: 네트워크 에러 시 null 반환", () => {
    it("givenNetworkError_whenGetSkinDetail_thenReturnsNull", async () => {
      // Given: fetch 가 network error 로 reject
      mockFetch.mockRejectedValueOnce(new TypeError("Network error"));

      // When: getSkinDetail(uuid)
      const result = await getSkinDetail("9fb348bc-41a0-91ad-8a3e-818035c4e561");

      // Then: null 반환
      expect(result).toBeNull();
    });
  });
});
