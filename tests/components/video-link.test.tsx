import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { VideoLink } from "@/components/skin-detail/VideoLink";

describe("Feature: 비디오 링크 컴포넌트 — Phase 2", () => {
  describe("Test 2-5: 허용 도메인의 streamedVideo 링크는 안전한 anchor로 렌더된다", () => {
    it("givenYoutubeStreamedVideo_whenRender_thenAnchorHasNoopenerNoreferrerAndTargetBlank", () => {
      // Given: streamedVideo === "https://youtu.be/abc123"
      render(<VideoLink url="https://youtu.be/abc123" />);

      // Then: a[href="https://youtu.be/abc123"] 존재
      const link = screen.getByRole("link", { name: /인게임 영상 보기/i });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", "https://youtu.be/abc123");

      // Then: target="_blank"
      expect(link).toHaveAttribute("target", "_blank");

      // Then: rel 에 "noopener" "noreferrer" "nofollow" 포함
      const rel = link.getAttribute("rel") || "";
      expect(rel).toContain("noopener");
      expect(rel).toContain("noreferrer");
      expect(rel).toContain("nofollow");
    });

    it("givenValorantApiVideo_whenRender_thenAnchorHasCorrectAttributes", () => {
      render(<VideoLink url="https://media.valorant-api.com/skins/video.mp4" />);

      const link = screen.getByRole("link");
      expect(link).toHaveAttribute("target", "_blank");

      const rel = link.getAttribute("rel") || "";
      expect(rel).toContain("noopener");
      expect(rel).toContain("noreferrer");
      expect(rel).toContain("nofollow");
    });
  });

  describe("Test 2-6: 허용되지 않은 도메인 / 비HTTPS는 링크가 렌더되지 않는다", () => {
    it("givenNonWhitelistedVideoUrl_whenRender_thenVideoLinkIsHiddenAndFallbackShown", () => {
      // Given: streamedVideo === "http://evil.example.com/x"
      render(<VideoLink url="http://evil.example.com/x" />);

      // Then: anchor 미존재
      const link = screen.queryByRole("link");
      expect(link).not.toBeInTheDocument();

      // Then: "인게임 영상 없음" fallback 텍스트 노출
      expect(screen.getByText(/인게임 영상 없음/i)).toBeInTheDocument();
    });

    it("givenJavascriptProtocol_whenRender_thenShowsFallback", () => {
      render(<VideoLink url="javascript:alert(1)" />);

      const link = screen.queryByRole("link");
      expect(link).not.toBeInTheDocument();
      expect(screen.getByText(/인게임 영상 없음/i)).toBeInTheDocument();
    });
  });

  describe("Test 2-7: streamedVideo가 null이면 fallback을 보여준다", () => {
    it("givenNoStreamedVideo_whenRender_thenShowsNoVideoFallback", () => {
      // Given: streamedVideo === null
      render(<VideoLink url={null} />);

      // Then: "인게임 영상 없음" 텍스트, anchor 0개
      const link = screen.queryByRole("link");
      expect(link).not.toBeInTheDocument();
      expect(screen.getByText(/인게임 영상 없음/i)).toBeInTheDocument();
    });

    it("givenUndefinedStreamedVideo_whenRender_thenShowsFallback", () => {
      render(<VideoLink url={undefined} />);

      const link = screen.queryByRole("link");
      expect(link).not.toBeInTheDocument();
      expect(screen.getByText(/인게임 영상 없음/i)).toBeInTheDocument();
    });
  });

  describe("HTTP URL은 차단된다", () => {
    it("givenHttpYoutubeUrl_whenRender_thenShowsFallback", () => {
      render(<VideoLink url="http://youtube.com/watch?v=abc123" />);

      const link = screen.queryByRole("link");
      expect(link).not.toBeInTheDocument();
      expect(screen.getByText(/인게임 영상 없음/i)).toBeInTheDocument();
    });
  });
});
