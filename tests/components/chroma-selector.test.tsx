import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ChromaSelector } from "@/components/skin-detail/ChromaSelector";
import type { Chroma } from "@/lib/domain/skin";

const mockChromas: Chroma[] = [
  {
    uuid: "chroma-1",
    displayName: "Base",
    fullRender: "https://example.com/chroma1.png",
    swatch: null,
  },
  {
    uuid: "chroma-2",
    displayName: "Gold",
    fullRender: "https://example.com/chroma2.png",
    swatch: null,
  },
  {
    uuid: "chroma-3",
    displayName: "Silver",
    fullRender: "https://example.com/chroma3.png",
    swatch: null,
  },
];

describe("Feature: 크로마 선택 컴포넌트 — Phase 2", () => {
  describe("Test 2-3: 크로마가 0/1개면 셀렉터가 숨겨진다", () => {
    it("givenSingleChroma_whenRender_thenChromaSelectorIsNotRendered", () => {
      // Given: chromas.length === 1
      const singleChroma: Chroma[] = [
        {
          uuid: "chroma-1",
          displayName: "Base",
          fullRender: "https://example.com/chroma1.png",
          swatch: null,
        },
      ];

      // When: render
      const { container } = render(
        <ChromaSelector chromas={singleChroma} onSelect={vi.fn()} />
      );

      // Then: queryByTestId("chroma-selector") 가 null
      const selector = container.querySelector('[data-testid="chroma-selector"]');
      expect(selector).not.toBeInTheDocument();
    });

    it("givenEmptyChromas_whenRender_thenChromaSelectorIsNotRendered", () => {
      const { container } = render(
        <ChromaSelector chromas={[]} onSelect={vi.fn()} />
      );

      const selector = container.querySelector('[data-testid="chroma-selector"]');
      expect(selector).not.toBeInTheDocument();
    });
  });

  describe("Test 2-2: 크로마 버튼 클릭 시 메인 이미지가 해당 크로마로 교체된다", () => {
    it("givenChromaSelector_whenUserClicksSecondChroma_thenOnSelectCalledWithCorrectIndex", () => {
      // Given: 렌더 완료된 상세 페이지
      const handleSelect = vi.fn();

      render(<ChromaSelector chromas={mockChromas} onSelect={handleSelect} />);

      // When: 두번째 크로마 버튼 클릭
      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBe(3);

      fireEvent.click(buttons[1]);

      // Then: onSelect(1) 호출
      expect(handleSelect).toHaveBeenCalledWith(1);
    });
  });

  describe("크로마 선택 시 aria-pressed 속성 업데이트", () => {
    it("givenChromaSelector_whenChromaSelected_thenSelectedButtonHasAriaPressedTrue", () => {
      render(<ChromaSelector chromas={mockChromas} onSelect={vi.fn()} selectedIndex={1} />);

      const buttons = screen.getAllByRole("button");

      // 첫 번째 버튼은 선택되지 않음
      expect(buttons[0]).toHaveAttribute("aria-pressed", "false");

      // 두 번째 버튼은 선택됨
      expect(buttons[1]).toHaveAttribute("aria-pressed", "true");
    });
  });

  describe("기본 렌더링", () => {
    it("givenMultipleChromas_whenRender_thenShowsAllChromaButtons", () => {
      render(<ChromaSelector chromas={mockChromas} onSelect={vi.fn()} />);

      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBe(3);

      // 각 버튼에 크로마 이름 표시
      expect(buttons[0]).toHaveTextContent("Base");
      expect(buttons[1]).toHaveTextContent("Gold");
      expect(buttons[2]).toHaveTextContent("Silver");
    });
  });
});
