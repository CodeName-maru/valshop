import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import SkinDetailPage from "@/app/(app)/skin/[id]/page";

// Mock getSkinDetail
const mockGetSkinDetail = vi.fn();
vi.mock("@/lib/valorant-api/catalog", () => ({
  getSkinDetail: () => mockGetSkinDetail(),
}));

// Mock notFound to throw NEXT_NOT_FOUND error
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

// Mock SkinDetailView
vi.mock("@/components/skin-detail/SkinDetailView", () => ({
  SkinDetailView: ({ skin }: { skin: any }) => (
    <div data-testid="skin-detail-view">
      <h1>{skin.displayName}</h1>
    </div>
  ),
}));

describe("Feature: 스킨 상세 페이지 — Phase 2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Test 2-8: 카탈로그에 UUID 없으면 notFound 처리된다", () => {
    it("givenUnknownUuid_whenPageRenders_thenThrowsNotFound", async () => {
      // Given: getSkinDetail 이 null 반환
      mockGetSkinDetail.mockResolvedValueOnce(null);

      // When/Then: SkinDetailPage 렌더 시 notFound() throw
      await expect(
        SkinDetailPage({ params: Promise.resolve({ id: "unknown-uuid" }) })
      ).rejects.toThrow("NEXT_NOT_FOUND");
    });
  });

  describe("정상 케이스: 스킨 데이터 있으면 렌더된다", () => {
    it("givenValidSkin_whenPageRenders_thenShowsSkinDetailView", async () => {
      // Given: getSkinDetail 이 스킨 데이터 반환
      const mockSkin = {
        uuid: "test-uuid",
        displayName: "Test Skin",
        displayIcon: "https://example.com/icon.png",
        chromas: [],
        levels: [],
        streamedVideo: null,
        contentTierUuid: null,
      };
      mockGetSkinDetail.mockResolvedValueOnce(mockSkin);

      // When: render page
      const rendered = await SkinDetailPage({
        params: Promise.resolve({ id: "test-uuid" }),
      });

      // Then: SkinDetailView 렌더
      const { container } = render(rendered);
      expect(container.querySelector("[data-testid='skin-detail-view']")).toBeInTheDocument();
      expect(screen.getByText("Test Skin")).toBeInTheDocument();
    });
  });
});
