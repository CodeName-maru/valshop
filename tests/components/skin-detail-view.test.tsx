import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SkinDetailView } from "@/components/skin-detail/SkinDetailView";
import type { SkinDetail } from "@/lib/domain/skin";

const mockSkinDetail: SkinDetail = {
  uuid: "9fb348bc-41a0-91ad-8a3e-818035c4e561",
  displayName: "Prime 2.0",
  displayIcon: "https://media.valorant-api.com/skins/9fb348bc/displayicon.png",
  chromas: [
    {
      uuid: "chroma-1",
      displayName: "Base",
      fullRender: "https://media.valorant-api.com/skins/chroma-1/fullrender.png",
      swatch: null,
    },
    {
      uuid: "chroma-2",
      displayName: "Gold",
      fullRender: "https://media.valorant-api.com/skins/chroma-2/fullrender.png",
      swatch: null,
    },
  ],
  levels: [
    {
      uuid: "level-1",
      displayName: "Level 1",
      displayIcon: "https://media.valorant-api.com/skins/level-1/icon.png",
      streamedVideo: null,
    },
    {
      uuid: "level-2",
      displayName: "Level 2",
      displayIcon: "https://media.valorant-api.com/skins/level-2/icon.png",
      streamedVideo: null,
    },
  ],
  streamedVideo: "https://youtu.be/abc123",
  contentTierUuid: "605ca61b-4e7f-ce3f-ec92-9bfc2e65999d",
};

describe("Feature: 스킨 상세 뷰 컴포넌트 — Phase 2", () => {
  describe("Test 2-1: 페이지가 스킨 이름·대표 이미지·크로마 개수를 렌더한다", () => {
    it("givenSkinWithThreeChromas_whenRender_thenShowsNameImageAndThreeChromaOptions", () => {
      // Given: 3 크로마 스킨
      const skinWith3Chromas: SkinDetail = {
        ...mockSkinDetail,
        chromas: [
          ...mockSkinDetail.chromas,
          {
            uuid: "chroma-3",
            displayName: "Silver",
            fullRender: "https://media.valorant-api.com/skins/chroma-3/fullrender.png",
            swatch: null,
          },
        ],
      };

      // When: render
      render(<SkinDetailView skin={skinWith3Chromas} />);

      // Then: h1 에 displayName
      const heading = screen.getByRole("heading", { level: 1 });
      expect(heading).toHaveTextContent("Prime 2.0");

      // Then: img 에 displayIcon (next/image transforms src)
      const mainImage = screen.getByTestId("main-skin-image");
      expect(mainImage).toBeInTheDocument();
      // next/image transforms the URL, so check if original URL is in the transformed src
      const imgSrc = mainImage.getAttribute("src") || "";
      expect(imgSrc).toContain("media.valorant-api.com");

      // Then: 크로마 버튼 3개 노출
      const chromaButtons = screen.getAllByRole("button");
      expect(chromaButtons.length).toBe(3);
    });
  });

  describe("Test 2-2: 크로마 버튼 클릭 시 메인 이미지가 해당 크로마로 교체된다", () => {
    it("givenChromaSelector_whenUserClicksSecondChroma_thenMainImageSrcChanges", async () => {
      // Given: 렌더 완료된 상세 페이지
      render(<SkinDetailView skin={mockSkinDetail} />);

      const mainImage = screen.getByTestId("main-skin-image");
      // Initial image contains chroma-1 URL
      expect(mainImage.src).toContain("chroma-1");

      // When: 두번째 크로마 버튼 클릭
      const chromaButtons = screen.getAllByRole("button");
      fireEvent.click(chromaButtons[1]);

      // Then: <img data-testid="main-skin-image"> 의 src 가 chromas[1].fullRender 로 바뀜
      await waitFor(() => {
        expect(mainImage.src).toContain("chroma-2");
      });
    });
  });

  describe("Test 2-4: 고화질 이미지가 lazy-load 속성을 갖는다", () => {
    it("givenMultipleLevelImages_whenRender_thenNonPrimaryImagesHaveLoadingLazy", () => {
      // Given: levels.length === 3 인 스킨
      const skinWithLevels: SkinDetail = {
        ...mockSkinDetail,
        levels: [
          ...mockSkinDetail.levels,
          {
            uuid: "level-3",
            displayName: "Level 3",
            displayIcon: "https://media.valorant-api.com/skins/level-3/icon.png",
            streamedVideo: null,
          },
        ],
      };

      // When: render
      render(<SkinDetailView skin={skinWithLevels} />);

      // Then: 메인 이미지는 loading="eager" (priority 이미지)
      const mainImage = screen.getByTestId("main-skin-image");
      expect(mainImage).toHaveAttribute("loading", "eager");

      // Then: 나머지 레벨 이미지 <img> 들은 loading="lazy"
      const levelImages = screen.getAllByTestId(/level-image-/);
      levelImages.forEach((img) => {
        expect(img).toHaveAttribute("loading", "lazy");
      });
    });
  });

  describe("비디오 링크 렌더링", () => {
    it("givenValidStreamedVideo_whenRender_thenShowsVideoLink", () => {
      render(<SkinDetailView skin={mockSkinDetail} />);

      const videoLink = screen.getByRole("link", { name: /인게임 영상 보기/i });
      expect(videoLink).toBeInTheDocument();
      expect(videoLink).toHaveAttribute("href", "https://youtu.be/abc123");
    });

    it("givenNullStreamedVideo_whenRender_thenShowsNoVideoFallback", () => {
      const skinWithoutVideo: SkinDetail = {
        ...mockSkinDetail,
        streamedVideo: null,
      };

      render(<SkinDetailView skin={skinWithoutVideo} />);

      expect(screen.getByText(/인게임 영상 없음/i)).toBeInTheDocument();
      const videoLink = screen.queryByRole("link", { name: /인게임 영상 보기/i });
      expect(videoLink).not.toBeInTheDocument();
    });
  });

  describe("레벨 이미지 리스트 렌더링", () => {
    it("givenSkinWithLevels_whenRender_thenShowsLevelImages", () => {
      render(<SkinDetailView skin={mockSkinDetail} />);

      const levelImages = screen.getAllByTestId(/level-image-/);
      expect(levelImages.length).toBe(mockSkinDetail.levels.length);
    });
  });
});
