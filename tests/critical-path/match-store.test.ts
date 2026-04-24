/**
 * Test 2-1 ~ 2-3: Wishlist-Store Matching Logic
 * Phase 2: Pure layer (matching logic)
 */

import { describe, it, expect } from "vitest";
import { matchStoreAgainstWishlist } from "@/lib/domain/wishlist";

describe("Feature: 위시리스트-상점 매칭", () => {
  describe("Scenario: 위시리스트 스킨이 상점에 포함", () => {
    it("given위시A상점AB_when매칭_then매칭스킨A반환", () => {
      // Given
      const store = ["A", "B", "C", "D"];
      const wish = ["A", "Z"];

      // When
      const matched = matchStoreAgainstWishlist(store, wish);

      // Then
      expect(matched).toEqual(["A"]);
    });
  });

  describe("Scenario: 매칭 없음", () => {
    it("given위시Z상점ABCD_when매칭_then빈배열", () => {
      // Given/When/Then
      expect(matchStoreAgainstWishlist(["A", "B", "C", "D"], ["Z"])).toEqual(
        []
      );
    });
  });

  describe("Scenario: 빈 위시리스트 (경계값)", () => {
    it("given빈위시_when매칭_then빈배열_그리고상점API호출스킵결정", () => {
      // Empty wishlist means we can skip calling storefront API
      expect(matchStoreAgainstWishlist(["A"], [])).toEqual([]);
    });

    it("given빈상점_when매칭_then빈배열", () => {
      // Empty store means no items to match
      expect(matchStoreAgainstWishlist([], ["A", "B"])).toEqual([]);
    });
  });

  describe("Scenario: 다중 매칭", () => {
    it("given위시AB상점ABCD_when매칭_then매칭스킨AB반환", () => {
      // Given
      const store = ["A", "B", "C", "D"];
      const wish = ["A", "B"];

      // When
      const matched = matchStoreAgainstWishlist(store, wish);

      // Then
      expect(matched).toEqual(["A", "B"]);
      expect(matched).toHaveLength(2);
    });
  });

  describe("Scenario: 중복 UUID 처리", () => {
    it("given위시에중복_when매칭_then중복제거", () => {
      // Given: wishlist has duplicates (shouldn't happen with PK constraint)
      const store = ["A", "B", "C"];
      const wish = ["A", "A", "B"];

      // When
      const matched = matchStoreAgainstWishlist(store, wish);

      // Then: Should return unique matches
      expect(matched).toEqual(["A", "B"]);
      expect(matched).toHaveLength(2);
    });
  });

  describe("Scenario: 순서 보존", () => {
    it("given매칭결과_when매칭_then상점순서보존", () => {
      // Given
      const store = ["D", "C", "B", "A"];
      const wish = ["A", "B"];

      // When
      const matched = matchStoreAgainstWishlist(store, wish);

      // Then: Result should follow store order, not wishlist order
      expect(matched).toEqual(["B", "A"]);
    });
  });
});
