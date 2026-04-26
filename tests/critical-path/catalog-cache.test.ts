/**
 * Feature: 메타 카탈로그 & 버전 캐시 레이어
 * Phase 2: ISR 캐시 검증 테스트
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getSkinCatalog, getTierCatalog } from "@/lib/valorant-api/catalog";
import { getClientVersion } from "@/lib/riot/version";

// Mock fetch globally
// MSW listen() in vitest.setup.ts patches globalThis.fetch in beforeAll,
// so we must (re)stub fetch in beforeEach to win against MSW interceptor.
const mockFetch = vi.fn();

describe("Feature: 메타 카탈로그 ISR 캐시", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("Scenario: 스킨 카탈로그 fetch는 ISR revalidate 86400 사용", () => {
    it("given_valorantApiSkinsResponse_whenGetSkinCatalog_thenFetchCalledWithRevalidate86400", async () => {
      // Given: MSW 가 /v1/weapons/skins 를 목킹
      const mockResponse = {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              uuid: "skin1",
              displayName: "Prime Vandal",
              displayIcon: "https://example.com/skin1.png",
              contentTierUuid: "tier1",
            },
          ],
        }),
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      // When: getSkinCatalog()
      await getSkinCatalog();

      // Then: fetch 2번째 인자 === { next: { revalidate: 86400 } }
      expect(mockFetch).toHaveBeenCalledWith(
        "https://valorant-api.com/v1/weapons/skins",
        {
          next: { revalidate: 86400 },
        }
      );
    });
  });

  describe("Scenario: 카탈로그 응답 → Map 변환", () => {
    it("given_skinCatalogArray_whenGetSkinCatalog_thenReturnsMapKeyedByUuid", async () => {
      // Given: [{ uuid: "a", displayName: "X", displayIcon: "...", contentTierUuid: "t" }]
      const mockResponse = {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              uuid: "skin-a",
              displayName: "Vandal A",
              displayIcon: "https://example.com/a.png",
              contentTierUuid: "tier-1",
            },
            {
              uuid: "skin-b",
              displayName: "Vandal B",
              displayIcon: "https://example.com/b.png",
              contentTierUuid: "tier-2",
            },
          ],
        }),
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      // When: getSkinCatalog()
      const result = await getSkinCatalog();

      // Then: Map.get("a") === { displayName: "X", ... }
      expect(result).toBeInstanceOf(Map);
      expect(result.get("skin-a")).toEqual({
        displayName: "Vandal A",
        displayIcon: "https://example.com/a.png",
        contentTierUuid: "tier-1",
      });
      expect(result.get("skin-b")).toEqual({
        displayName: "Vandal B",
        displayIcon: "https://example.com/b.png",
        contentTierUuid: "tier-2",
      });
    });
  });

  describe("Scenario: tier 카탈로그 동일 패턴", () => {
    it("given_tierCatalog_whenGetTierCatalog_thenReturnsMapWithRevalidate86400", async () => {
      // Given: contenttiers 응답
      const mockResponse = {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              uuid: "tier-1",
              displayName: "Exclusive",
              displayIcon: "https://example.com/tier1.png",
            },
            {
              uuid: "tier-2",
              displayName: "Premium",
              displayIcon: "https://example.com/tier2.png",
            },
          ],
        }),
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      // When: getTierCatalog()
      const result = await getTierCatalog();

      // Then: Map 반환 + revalidate 86400
      expect(mockFetch).toHaveBeenCalledWith(
        "https://valorant-api.com/v1/contenttiers",
        {
          next: { revalidate: 86400 },
        }
      );
      expect(result).toBeInstanceOf(Map);
      expect(result.get("tier-1")).toEqual({
        displayIcon: "https://example.com/tier1.png",
      });
    });
  });
});

describe("Feature: Client Version Resolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("Scenario: client version resolver ISR 3600", () => {
    it("given_versionEndpoint_whenGetClientVersion_thenFetchCalledWithRevalidate3600", async () => {
      // Given: MSW /v1/version → { data: { riotClientVersion: "release-..." } }
      const mockResponse = {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            riotClientVersion: "release-08.11-shipping-6-3154137",
          },
        }),
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      // When: getClientVersion()
      const version = await getClientVersion();

      // Then: 문자열 반환 + fetch { next: { revalidate: 3600 } }
      expect(version).toBe("release-08.11-shipping-6-3154137");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://valorant-api.com/v1/version",
        {
          next: { revalidate: 3600 },
        }
      );
    });
  });
});
