import { describe, it, expect } from "vitest";
import { parseNightMarket } from "../../lib/riot/night-market";
import type { NightMarketState } from "../../lib/domain/night-market";
import fixtureNoBonus from "./fixtures/storefront-no-bonus.json";
import fixtureBonus from "./fixtures/storefront-bonus.json";

describe("Feature: 야시장 파싱", () => {
  describe("Scenario: BonusStore 없음", () => {
    it("Given BonusStore 없음, When parse, Then active:false", () => {
      // Given
      const storefront = fixtureNoBonus as any;
      // When
      const result = parseNightMarket(storefront);
      // Then
      expect(result.active).toBe(false);
    });
  });

  describe("Scenario: BonusStore 6개 아이템 + 할인율 파싱", () => {
    it("Given BonusStore 6 offers, When parse, Then 6 items + discount% 정수", () => {
      // Given
      const storefront = fixtureBonus as any;
      // When
      const result = parseNightMarket(storefront) as NightMarketState;
      // Then
      expect(result.active).toBe(true);
      if (!result.active) throw new Error("expected active");

      expect(result.market.items).toHaveLength(6);
      for (const item of result.market.items) {
        expect(item.discountPercent).toBeGreaterThanOrEqual(1);
        expect(item.discountPercent).toBeLessThanOrEqual(99);
        expect(item.discountedPriceVp).toBeLessThan(item.originalPriceVp);
      }
      expect(result.market.endsAtEpochMs).toBeGreaterThan(Date.now());
    });
  });
});
