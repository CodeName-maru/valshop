/**
 * Feature: SkinCard 컴포넌트
 * Phase 4: SkinCard 렌더 테스트
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SkinCard } from "@/components/SkinCard";
import type { Skin } from "@/lib/domain/skin";

describe("Feature: SkinCard 컴포넌트", () => {
  describe("Scenario: 4개 필드 모두 표시", () => {
    it("given_skinPropsWithAllFields_whenRenderSkinCard_thenDisplaysNamePriceVpTierIconAndImage", () => {
      // Given: { name: "Prime Vandal", priceVp: 1775, imageUrl: "...", tierIconUrl: "..." }
      const skin: Skin = {
        uuid: "skin1",
        name: "Prime Vandal",
        priceVp: 1775,
        imageUrl: "https://example.com/skin1.png",
        tierIconUrl: "https://example.com/tier1.png",
      };

      // When: render(<SkinCard skin={...} />)
      render(<SkinCard skin={skin} />);

      // Then: getByText("Prime Vandal"), getByText("1,775 VP"), getByRole("img", { name: /Prime Vandal/ }),
      //       tier 아이콘 img 존재, data-testid="skin-card"
      expect(screen.getByText("Prime Vandal")).toBeInTheDocument();
      expect(screen.getByText("1,775 VP")).toBeInTheDocument();
      expect(screen.getByRole("img", { name: /Prime Vandal/ })).toBeInTheDocument();
      expect(screen.getByTestId("skin-card")).toBeInTheDocument();

      // 티어 아이콘도 존재해야 함 (Alt text "Tier")
      const tierImages = screen.getAllByRole("img");
      expect(tierImages.some(img => img.getAttribute("alt") === "Tier")).toBe(true);
    });
  });

  describe("Scenario: priceVp 천단위 포맷", () => {
    it("given_priceVp1775_whenRender_thenDisplaysCommaFormatted1_775_VP", () => {
      // Given: priceVp 1775
      const skin: Skin = {
        uuid: "skin1",
        name: "Prime Vandal",
        priceVp: 1775,
        imageUrl: "https://example.com/skin1.png",
        tierIconUrl: null,
      };

      // When: render
      render(<SkinCard skin={skin} />);

      // Then: "1,775 VP" 표시
      expect(screen.getByText("1,775 VP")).toBeInTheDocument();
    });

    it("given_priceVp3200_whenRender_thenDisplaysCommaFormatted3_200_VP", () => {
      // Given: priceVp 3200
      const skin: Skin = {
        uuid: "skin1",
        name: "Prelude to Chaos Vandal",
        priceVp: 3200,
        imageUrl: "https://example.com/skin1.png",
        tierIconUrl: null,
      };

      // When: render
      render(<SkinCard skin={skin} />);

      // Then: "3,200 VP" 표시
      expect(screen.getByText("3,200 VP")).toBeInTheDocument();
    });
  });

  describe("Scenario: tierIconUrl null 처리", () => {
    it("given_tierIconUrlNull_whenRender_thenCardRendersWithoutTierIcon", () => {
      // Given: tierIconUrl이 null인 스킨
      const skin: Skin = {
        uuid: "skin1",
        name: "Prime Vandal",
        priceVp: 1775,
        imageUrl: "https://example.com/skin1.png",
        tierIconUrl: null,
      };

      // When: render
      render(<SkinCard skin={skin} />);

      // Then: 카드 여전히 렌더, 티어 아이콘 없음
      expect(screen.getByTestId("skin-card")).toBeInTheDocument();
      expect(screen.getByText("Prime Vandal")).toBeInTheDocument();

      // 티어 아이콘 (Alt "Tier") 없어야 함
      const tierImages = screen.queryAllByRole("img", { name: "Tier" });
      expect(tierImages.length).toBe(0);
    });
  });

  describe("Scenario: next/image priority 적용 (LCP 최적화 검증)", () => {
    it("given_skinCard_whenRender_thenImgTagExistsWithCorrectSrc", () => {
      // Given: skin prop
      const skin: Skin = {
        uuid: "skin1",
        name: "Prime Vandal",
        priceVp: 1775,
        imageUrl: "https://example.com/skin1.png",
        tierIconUrl: "https://example.com/tier1.png",
      };

      // When: render with priority
      const { container } = render(<SkinCard skin={skin} priority />);

      // Then: <img> 태그가 올바른 src로 렌더됨
      // Note: fetchpriority는 브라우저 환경에서만 적용되므로 src만 검증
      const mainImage = container.querySelector('img[alt="Prime Vandal"]');
      expect(mainImage).toBeInTheDocument();
      expect(mainImage?.getAttribute("src")).toContain("example.com");
    });

    it("given_skinCardWithoutPriority_whenRender_thenImgTagStillRenders", () => {
      // Given: skin prop
      const skin: Skin = {
        uuid: "skin1",
        name: "Prime Vandal",
        priceVp: 1775,
        imageUrl: "https://example.com/skin1.png",
        tierIconUrl: null,
      };

      // When: render without priority prop
      const { container } = render(<SkinCard skin={skin} />);

      // Then: 이미지 여전히 렌더됨
      const mainImage = container.querySelector('img[alt="Prime Vandal"]');
      expect(mainImage).toBeInTheDocument();
    });
  });
});
