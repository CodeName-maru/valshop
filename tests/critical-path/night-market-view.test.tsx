import { render, screen } from "@testing-library/react";
import { NightMarketView } from "../../app/(app)/night-market/view";
import type { NightMarket, SkinMeta } from "../../lib/domain/night-market";

// Mock skin meta
const mockMetaBySkin: Record<string, SkinMeta> = {};

describe("Feature: 야시장 뷰", () => {
  describe("Scenario: 6개 카드 + 할인율 렌더", () => {
    it("Given active market 6 items, When render, Then 6 카드 + '-%' 노출", () => {
      // Given
      const market: NightMarket = {
        items: Array.from({ length: 6 }, (_, i) => ({
          skinUuid: `uuid-${i}`,
          originalPriceVp: 1775,
          discountedPriceVp: 1000,
          discountPercent: 44,
          isRevealed: true,
        })),
        endsAtEpochMs: Date.now() + 86400000,
      };

      // When
      render(<NightMarketView market={market} metaBySkin={mockMetaBySkin} />);

      // Then
      const cards = screen.getAllByTestId("night-market-card");
      expect(cards).toHaveLength(6);
      // 할인율 표시 확인 (44%)
      expect(screen.getAllByText(/44%/).length).toBeGreaterThan(0);
    });
  });

  describe("Scenario: 할인율 계산 및 표시", () => {
    it("Given 30% 할인, When render, Then '-30%' 노출", () => {
      const market: NightMarket = {
        items: [
          {
            skinUuid: "uuid-1",
            originalPriceVp: 1775,
            discountedPriceVp: 1242,
            discountPercent: 30,
            isRevealed: true,
          },
        ],
        endsAtEpochMs: Date.now() + 86400000,
      };

      render(<NightMarketView market={market} metaBySkin={mockMetaBySkin} />);

      expect(screen.getByText(/-30%/)).toBeInTheDocument();
    });
  });
});
