import { describe, it, expect } from "vitest";
import { isSafeExternalVideoUrl } from "@/lib/security/url";

describe("Feature: 영상 링크 보안 검증 — Phase 2", () => {
  describe("Test 2-url-test: isSafeExternalVideoUrl 화이트리스트 검증", () => {
    describe("허용 도메인의 YouTube 링크는 통과", () => {
      it("givenYoutubeUrl_whenIsSafeExternalVideoUrl_thenReturnsTrue", () => {
        expect(isSafeExternalVideoUrl("https://youtu.be/abc123")).toBe(true);
        expect(isSafeExternalVideoUrl("https://www.youtube.com/watch?v=abc123")).toBe(true);
        expect(isSafeExternalVideoUrl("https://youtube.com/watch?v=abc123")).toBe(true);
      });
    });

    describe("허용 도메인의 Valorant API 링크는 통과", () => {
      it("givenValorantApiUrl_whenIsSafeExternalVideoUrl_thenReturnsTrue", () => {
        expect(
          isSafeExternalVideoUrl("https://media.valorant-api.com/skin/video.mp4")
        ).toBe(true);
      });
    });

    describe("null/undefined는 false", () => {
      it("givenNullOrUndefined_whenIsSafeExternalVideoUrl_thenReturnsFalse", () => {
        expect(isSafeExternalVideoUrl(null)).toBe(false);
        expect(isSafeExternalVideoUrl(undefined)).toBe(false);
      });
    });

    describe("비HTTPS는 차단 (Security NFR)", () => {
      it("givenHttpUrl_whenIsSafeExternalVideoUrl_thenReturnsFalse", () => {
        expect(isSafeExternalVideoUrl("http://youtube.com/watch?v=abc123")).toBe(false);
        expect(isSafeExternalVideoUrl("http://media.valorant-api.com/video.mp4")).toBe(false);
      });
    });

    describe("비허용 도메인은 차단 (Security NFR)", () => {
      it("givenNonWhitelistedDomain_whenIsSafeExternalVideoUrl_thenReturnsFalse", () => {
        expect(isSafeExternalVideoUrl("https://evil.example.com/x")).toBe(false);
        expect(isSafeExternalVideoUrl("https://vimeo.com/123456")).toBe(false);
        expect(isSafeExternalVideoUrl("https://twitch.tv/videos/123456")).toBe(false);
      });
    });

    describe("javascript: 프로토콜은 차단 (XSS 방지)", () => {
      it("givenJavascriptProtocol_whenIsSafeExternalVideoUrl_thenReturnsFalse", () => {
        expect(isSafeExternalVideoUrl("javascript:alert(1)")).toBe(false);
        expect(isSafeExternalVideoUrl("JAVASCRIPT:alert(1)")).toBe(false);
      });
    });

    describe("잘못된 URL 형식은 차단", () => {
      it("givenInvalidUrl_whenIsSafeExternalVideoUrl_thenReturnsFalse", () => {
        expect(isSafeExternalVideoUrl("not-a-url")).toBe(false);
        expect(isSafeExternalVideoUrl("")).toBe(false);
        expect(isSafeExternalVideoUrl("://invalid")).toBe(false);
      });
    });
  });
});
