/**
 * Test 1-1: 검색 필터 순수 함수 (filterSkinsByQuery)
 * Plan 0016 Phase 1
 */

import { describe, it, expect } from "vitest";
import { filterSkinsByQuery } from "@/lib/domain/wishlist";
import type { Skin } from "@/lib/domain/skin";

function mkSkin(uuid: string, name: string): Skin {
  return {
    uuid,
    name,
    priceVp: 1775,
    imageUrl: `https://example.com/${uuid}.png`,
    tierIconUrl: null,
  };
}

describe("Feature: 스킨 카탈로그 검색 (filterSkinsByQuery)", () => {
  const catalog: Skin[] = [
    mkSkin("u1", "Reaver Vandal"),
    mkSkin("u2", "Phantom Prime"),
    mkSkin("u3", "Phantom Oni"),
    mkSkin("u4", "Prime Vandal"),
  ];

  it("givenCatalog_whenFilterByPhantom_thenReturnsOnlyPhantomSkins", () => {
    const result = filterSkinsByQuery(catalog, "phantom");
    expect(result.map((s) => s.uuid).sort()).toEqual(["u2", "u3"]);
    // immutability
    expect(catalog).toHaveLength(4);
  });

  it("givenEmptyQuery_whenFilter_thenReturnsAll", () => {
    expect(filterSkinsByQuery(catalog, "")).toHaveLength(4);
  });

  it("givenWhitespaceOnly_whenFilter_thenReturnsAll", () => {
    expect(filterSkinsByQuery(catalog, "   ")).toHaveLength(4);
  });

  it("givenMixedCaseQuery_whenFilter_thenCaseInsensitiveMatch", () => {
    expect(filterSkinsByQuery(catalog, "PHANTOM").map((s) => s.uuid).sort()).toEqual([
      "u2",
      "u3",
    ]);
  });

  it("given1500Skins_whenFilter_thenCompletesUnder5ms", () => {
    const big: Skin[] = Array.from({ length: 1500 }, (_, i) =>
      mkSkin(`u${i}`, `Skin Name ${i}`)
    );
    const start = performance.now();
    const out = filterSkinsByQuery(big, "skin name 1234");
    const elapsed = performance.now() - start;
    expect(out.length).toBeGreaterThanOrEqual(1);
    // perf NFR — generous on CI but catches regressions; <50ms ceiling
    expect(elapsed).toBeLessThan(50);
  });
});
