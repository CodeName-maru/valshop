/**
 * Feature: Storefront 응답 파싱
 * Phase 1: 도메인 타입 & 순수 파싱 함수 테스트
 */

import { describe, it, expect } from "vitest";
import { parseStorefront, StorefrontParseError } from "@/lib/riot/storefront";
import { matchSkinMeta, type Skin } from "@/lib/valorant-api/match";
import type { StorefrontOffer } from "@/lib/domain/skin";

describe("Feature: Storefront 응답 파싱", () => {
  describe("Scenario: 정상 응답 4개 스킨", () => {
    it("given_storefrontJsonWithFourOffers_whenParse_thenReturnsTodayStoreWithFourEntries", () => {
      // Given: Riot storefront 샘플 JSON (SkinsPanelLayout.SingleItemStoreOffers 4개)
      const now = new Date("2026-04-23T12:00:00Z");
      const storefrontJson = {
        SkinsPanelLayout: {
          SingleItemStoreOffers: [
            {
              OfferID: "offer1",
            },
            {
              OfferID: "offer2",
            },
            {
              OfferID: "offer3",
            },
            {
              OfferID: "offer4",
            },
          ],
          SingleItemOffersRemainingDurationInSeconds: 3600,
        },
      };

      // When: parseStorefront(json)
      const result = parseStorefront(storefrontJson, now);

      // Then: { offers: [{ skinUuid, priceVp }, ...×4], rotationEndsAt: Date } 반환
      expect(result.offers).toHaveLength(4);
      expect(result.offers[0]).toEqual({
        skinUuid: "offer1",
        priceVp: 0, // Costs는 API 응답에 따라 다름, 일단 0으로 초기화
      });
      expect(result.rotationEndsAt).toEqual(new Date("2026-04-23T13:00:00Z"));
    });
  });

  describe("Scenario: 로테이션 TTL epoch 변환", () => {
    it("given_singleItemOffersRemainingDurationInSeconds_whenParse_thenRotationEndsAtIsNowPlusSeconds", () => {
      // Given: SingleItemOffersRemainingDurationInSeconds = 3600
      const now = new Date("2026-04-23T12:00:00Z");
      const storefrontJson = {
        SkinsPanelLayout: {
          SingleItemStoreOffers: [{ OfferID: "offer1" }],
          SingleItemOffersRemainingDurationInSeconds: 3600,
        },
      };

      // When: parseStorefront(json, now)
      const result = parseStorefront(storefrontJson, now);

      // Then: rotationEndsAt === now + 3600s (±1s)
      const expectedTime = new Date(now.getTime() + 3600 * 1000);
      expect(result.rotationEndsAt.getTime()).toBe(expectedTime.getTime());
    });
  });

  describe("Scenario: 필수 필드 누락 시 명시적 에러", () => {
    it("given_malformedStorefrontJsonMissingOffers_whenParse_thenThrowsStorefrontParseError", () => {
      // Given: SkinsPanelLayout 필드 없는 JSON
      const malformedJson = {
        // SkinsPanelLayout 필드 없음
        SomeOtherField: "value",
      };

      // When & Then: parseStorefront(json) → StorefrontParseError 예외
      expect(() => parseStorefront(malformedJson)).toThrow(StorefrontParseError);
    });

    it("given_emptyOffers_whenParse_thenReturnsEmptyOffers", () => {
      // Given: 빈 offers 배열
      const storefrontJson = {
        SkinsPanelLayout: {
          SingleItemStoreOffers: [],
          SingleItemOffersRemainingDurationInSeconds: 3600,
        },
      };

      // When: parseStorefront(json)
      const result = parseStorefront(storefrontJson);

      // Then: 빈 배열 반환
      expect(result.offers).toHaveLength(0);
    });
  });
});

describe("Feature: 메타 매칭 (UUID → Skin 도메인)", () => {
  describe("Scenario: 정상 매칭", () => {
    it("given_fourSkinUuidsAndCatalog_whenMatchMeta_thenReturnsFourSkinDomainObjects", () => {
      // Given: offers 4개 + catalog Map<uuid, {displayName, displayIcon, contentTierUuid}>
      const offers: StorefrontOffer[] = [
        { skinUuid: "skin1", priceVp: 1775 },
        { skinUuid: "skin2", priceVp: 2375 },
        { skinUuid: "skin3", priceVp: 1275 },
        { skinUuid: "skin4", priceVp: 3200 },
      ];

      const skinCatalog = new Map([
        [
          "skin1",
          {
            displayName: "Prime Vandal",
            displayIcon: "https://example.com/skin1.png",
            contentTierUuid: "tier1",
          },
        ],
        [
          "skin2",
          {
            displayName: "Reaver Vandal",
            displayIcon: "https://example.com/skin2.png",
            contentTierUuid: "tier2",
          },
        ],
        [
          "skin3",
          {
            displayName: "Elderflame Vandal",
            displayIcon: "https://example.com/skin3.png",
            contentTierUuid: "tier3",
          },
        ],
        [
          "skin4",
          {
            displayName: "Prelude to Chaos Vandal",
            displayIcon: "https://example.com/skin4.png",
            contentTierUuid: "tier4",
          },
        ],
      ]);

      const tierCatalog = new Map([
        ["tier1", { displayIcon: "https://example.com/tier1.png" }],
        ["tier2", { displayIcon: "https://example.com/tier2.png" }],
        ["tier3", { displayIcon: "https://example.com/tier3.png" }],
        ["tier4", { displayIcon: "https://example.com/tier4.png" }],
      ]);

      // When: matchSkinMeta(offers, catalog, tierCatalog)
      const result = matchSkinMeta(offers, skinCatalog, tierCatalog);

      // Then: [{ uuid, name, priceVp, imageUrl, tierIconUrl }] ×4
      expect(result).toHaveLength(4);
      expect(result[0]).toEqual({
        uuid: "skin1",
        name: "Prime Vandal",
        priceVp: 1775,
        imageUrl: "https://example.com/skin1.png",
        tierIconUrl: "https://example.com/tier1.png",
      });
    });
  });

  describe("Scenario: 카탈로그에 없는 UUID 처리 (신규 스킨)", () => {
    it("given_skinUuidMissingFromCatalog_whenMatchMeta_thenReturnsPlaceholderEntry", () => {
      // Given: offers[0].skinUuid 가 catalog 에 없음
      const offers: StorefrontOffer[] = [
        { skinUuid: "unknown-skin", priceVp: 1775 },
        { skinUuid: "skin1", priceVp: 2375 },
      ];

      const skinCatalog = new Map([
        [
          "skin1",
          {
            displayName: "Prime Vandal",
            displayIcon: "https://example.com/skin1.png",
            contentTierUuid: "tier1",
          },
        ],
      ]);

      const tierCatalog = new Map([
        ["tier1", { displayIcon: "https://example.com/tier1.png" }],
      ]);

      // When: matchSkinMeta(offers, catalog, tierCatalog)
      const result = matchSkinMeta(offers, skinCatalog, tierCatalog);

      // Then: 해당 entry 는 placeholder
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        uuid: "unknown-skin",
        name: "Unknown Skin",
        priceVp: 1775,
        imageUrl: "/placeholder.png",
        tierIconUrl: null,
      });
      expect(result[1].name).toBe("Prime Vandal");
    });
  });

  describe("Scenario: 티어 아이콘 없는 스킨", () => {
    it("given_skinWithNullContentTierUuid_whenMatchMeta_thenReturnsNullTierIconUrl", () => {
      // Given: contentTierUuid가 null인 스킨
      const offers: StorefrontOffer[] = [
        { skinUuid: "skin1", priceVp: 1775 },
      ];

      const skinCatalog = new Map([
        [
          "skin1",
          {
            displayName: "Prime Vandal",
            displayIcon: "https://example.com/skin1.png",
            contentTierUuid: null,
          },
        ],
      ]);

      const tierCatalog = new Map([]);

      // When: matchSkinMeta(offers, catalog, tierCatalog)
      const result = matchSkinMeta(offers, skinCatalog, tierCatalog);

      // Then: tierIconUrl이 null
      expect(result[0].tierIconUrl).toBeNull();
      expect(result[0].name).toBe("Prime Vandal");
    });
  });
});
