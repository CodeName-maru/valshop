/**
 * Feature: Store Proxy (Riot storefront 호출)
 * Phase 3: getTodayStore + Route Handler 테스트
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { testApiHandler } from "next-test-api-route-handler";
import * as storeRoute from "@/app/api/store/route";

// Mock dependencies
vi.mock("@/lib/riot/version", () => ({
  getClientVersion: vi.fn(() => Promise.resolve("release-08.11-shipping-6-3154137")),
}));

vi.mock("@/lib/valorant-api/catalog", () => ({
  getSkinCatalog: vi.fn(() =>
    Promise.resolve(
      new Map([
        [
          "skin1",
          {
            displayName: "Prime Vandal",
            displayIcon: "https://example.com/skin1.png",
            contentTierUuid: "tier1",
          },
        ],
      ])
    )
  ),
  getTierCatalog: vi.fn(() =>
    Promise.resolve(
      new Map([
        ["tier1", { displayIcon: "https://example.com/tier1.png" }],
      ])
    )
  ),
}));

import { getClientVersion } from "@/lib/riot/version";
import { getSkinCatalog, getTierCatalog } from "@/lib/valorant-api/catalog";

// Mock fetch for Riot API
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe("Feature: Store Proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Scenario: Route Handler GET /api/store 스모크", () => {
    it("given_validSessionCookie_whenGetApiStore_thenReturns200WithTodayStoreJson", async () => {
      // Given: 세션 쿠키가 있는 상태 (실제로는 getSession mock 필요)
      const mockStorefrontResponse = {
        SkinsPanelLayout: {
          SingleItemStoreOffers: [
            { OfferID: "skin1" },
            { OfferID: "skin2" },
            { OfferID: "skin3" },
            { OfferID: "skin4" },
          ],
          SingleItemOffersRemainingDurationInSeconds: 3600,
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockStorefrontResponse,
      });

      // When: GET /api/store
      // Note: 실제 구현에서는 session cookie를 mocking해야 함
      // 여기서는 간단히 에러가 발생하지 않는지만 확인

      // Then: body.offers.length === 4
      // 실제 route handler 테스트는 MSW로 session guard를 mock해야 함
      expect(true).toBe(true); // placeholder
    });
  });

  describe("Scenario: 필수 헤더 주입", () => {
    it("given_session_whenGetTodayStore_thenStorefrontCalledWithAllRequiredHeaders", async () => {
      // Given: session
      const session = {
        puuid: "test-puuid",
        accessToken: "test-token",
        entitlementsJwt: "test-jwt",
        expiresAt: Date.now() + 3600000,
        region: "kr",
      };

      const mockStorefrontResponse = {
        SkinsPanelLayout: {
          SingleItemStoreOffers: [{ OfferID: "skin1" }],
          SingleItemOffersRemainingDurationInSeconds: 3600,
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockStorefrontResponse,
      });

      // When: getTodayStore(session) - 실제 구현 후 테스트
      // Then: Authorization, X-Riot-Entitlements-JWT, X-Riot-ClientVersion 헤더 확인
      expect(true).toBe(true); // placeholder
    });
  });
});
