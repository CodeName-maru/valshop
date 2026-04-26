/**
 * Feature: Dashboard SSR 통합
 * Phase 4: Dashboard SSR 테스트
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToString } from "react-dom/server";
import DashboardPage from "@/app/(app)/dashboard/page";
import { RiotApiError } from "@/lib/riot/fetcher";

// Mock dependencies
vi.mock("@/lib/session/guard", () => ({
  requireSession: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@/lib/riot/storefront", () => ({
  getTodayStore: vi.fn(),
}));

// Mock client components that use Next.js hooks
vi.mock("@/components/LogoutButton", () => ({
  LogoutButton: () => <button data-testid="logout-button">Logout</button>,
}));

vi.mock("@/components/Countdown", () => ({
  Countdown: () => <div data-testid="countdown">00:00:00</div>,
}));

vi.mock("@/app/(app)/dashboard/RetryButton", () => ({
  RetryButton: () => <button data-testid="retry-button">재시도</button>,
}));

import { requireSession } from "@/lib/session/guard";
import { getTodayStore } from "@/lib/riot/storefront";
import type { SessionPayload } from "@/lib/session/types";

describe("Feature: Dashboard SSR 통합", () => {
  const mockSession: SessionPayload = {
    puuid: "test-puuid",
    accessToken: "test-token",
    entitlementsJwt: "test-jwt",
    expiresAt: Date.now() + 3600000,
    region: "kr",
  };

  const mockStore = {
    offers: [
      {
        uuid: "skin1",
        name: "Prime Vandal",
        priceVp: 1775,
        imageUrl: "https://example.com/skin1.png",
        tierIconUrl: "https://example.com/tier1.png",
      },
      {
        uuid: "skin2",
        name: "Reaver Vandal",
        priceVp: 2375,
        imageUrl: "https://example.com/skin2.png",
        tierIconUrl: "https://example.com/tier2.png",
      },
      {
        uuid: "skin3",
        name: "Elderflame Vandal",
        priceVp: 1275,
        imageUrl: "https://example.com/skin3.png",
        tierIconUrl: "https://example.com/tier3.png",
      },
      {
        uuid: "skin4",
        name: "Prelude to Chaos Vandal",
        priceVp: 3200,
        imageUrl: "https://example.com/skin4.png",
        tierIconUrl: "https://example.com/tier4.png",
      },
    ],
    rotationEndsAt: new Date("2026-04-23T13:00:00Z"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("Scenario: Dashboard SSR — 4 카드 HTML 포함", () => {
    it("given_validSession_whenRenderDashboardServerComponent_thenHtmlContainsFourSkinCardDataTestid", async () => {
      // Given: getSession mock → valid, getTodayStore mock → 4 offers
      vi.mocked(requireSession).mockResolvedValue(mockSession as any);
      vi.mocked(getTodayStore).mockResolvedValue(mockStore as any);

      // When: await DashboardPage() 렌더 후 HTML 직렬화
      const html = renderToString(await DashboardPage());

      // Then: 4×data-testid="skin-card"
      const matches = html.match(/data-testid="skin-card"/g);
      expect(matches).toHaveLength(4);
    });

    it("given_validSession_whenRenderDashboard_thenContainsAllSkinNames", async () => {
      // Given: mocks 설정
      vi.mocked(requireSession).mockResolvedValue(mockSession as any);
      vi.mocked(getTodayStore).mockResolvedValue(mockStore as any);

      // When: render
      const html = renderToString(await DashboardPage());

      // Then: 모든 스킨 이름 포함
      expect(html).toContain("Prime Vandal");
      expect(html).toContain("Reaver Vandal");
      expect(html).toContain("Elderflame Vandal");
      expect(html).toContain("Prelude to Chaos Vandal");
    });
  });

  describe("Scenario: Dashboard 세션 없음 → /login redirect", () => {
    it("given_noSession_whenRenderDashboard_thenRedirectsToLogin", async () => {
      // Given: requireSession이 UNAUTHENTICATED 에러를 throw
      vi.mocked(requireSession).mockRejectedValue(new Error("UNAUTHENTICATED"));

      // When/Then: redirect 호출 → NEXT_REDIRECT throw
      await expect(DashboardPage()).rejects.toThrow(/NEXT_REDIRECT|UNAUTHENTICATED/);
    });
  });

  describe("Scenario: Dashboard storefront 에러 → 에러 카드 + 재시도 버튼", () => {
    it("given_storefrontThrowsRiotUpstreamError_whenRenderDashboard_thenShowsErrorStateWithRetryButton", async () => {
      // Given: requireSession은 성공, getTodayStore는 RiotUpstreamError throw
      vi.mocked(requireSession).mockResolvedValue(mockSession as any);
      vi.mocked(getTodayStore).mockRejectedValue(
        new RiotApiError("RIOT_5XX", "Riot server error")
      );

      // When: render
      const html = renderToString(await DashboardPage());

      // Then: 에러 메시지 표시 + 재시도 버튼
      expect(html).toContain("상점 정보를 불러올 수 없습니다");
      expect(html).toMatch(/data-testid="retry-button"|재시도/);
    });

    it("given_storefrontThrowsRateLimitedError_whenRenderDashboard_thenShowsErrorState", async () => {
      // Given: getTodayStore가 RIOT_RATE_LIMITED 에러 throw
      vi.mocked(requireSession).mockResolvedValue(mockSession as any);
      vi.mocked(getTodayStore).mockRejectedValue(
        new RiotApiError("RIOT_RATE_LIMITED", "Rate limited")
      );

      // When: render
      const html = renderToString(await DashboardPage());

      // Then: 에러 상태 표시
      expect(html).toContain("상점 정보를 불러올 수 없습니다");
    });
  });

  describe("Scenario: 토큰 만료 → /login?reason=expired redirect", () => {
    it("given_tokenExpiredError_whenRenderDashboard_thenRedirectsToLogin", async () => {
      // Given: getTodayStore가 TOKEN_EXPIRED 에러 throw
      vi.mocked(requireSession).mockResolvedValue(mockSession as any);
      vi.mocked(getTodayStore).mockRejectedValue(
        new RiotApiError("TOKEN_EXPIRED", "Token expired")
      );

      // When & Then: redirect 호출 → NEXT_REDIRECT throw
      await expect(DashboardPage()).rejects.toThrow(/NEXT_REDIRECT/);
    });
  });
});
