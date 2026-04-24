import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// useSearchParams 모킹: 테스트 별로 currentQuery 를 바꿔서 시뮬레이션
let currentQuery = "";
function mockUseSearchParams(qs: string) {
  currentQuery = qs;
}

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (k: string) => new URLSearchParams(currentQuery).get(k),
  }),
}));

// page 는 mock 셋업 이후 import
import LoginPage from "@/app/(app)/login/page";

beforeEach(() => {
  currentQuery = "";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Feature: 로그인 페이지 버튼 배선", () => {
  describe("Scenario: 정상 클릭", () => {
    it("givenIdleLoginPage_whenClickStartButton_thenAnchorPointsToAuthStart", () => {
      render(<LoginPage />);
      const link = screen.getByRole("link", { name: /Riot 로 로그인/ });
      expect(link).toHaveAttribute("href", "/api/auth/start");
    });

    it("givenIdleButton_whenClicked_thenBecomesDisabledWithLoadingLabel", () => {
      render(<LoginPage />);
      const link = screen.getByRole("link", { name: /Riot 로 로그인/ });
      fireEvent.click(link);
      expect(link).toHaveAttribute("aria-disabled", "true");
      expect(link).toHaveTextContent(/이동 중/);
    });

    it("givenButtonClickedOnce_whenClickedAgain_thenSecondClickPrevented", () => {
      render(<LoginPage />);
      const link = screen.getByRole("link", { name: /Riot 로 로그인/ });
      // 첫 클릭 → loading=true 진입
      fireEvent.click(link);
      // 두 번째 클릭은 onClick 안에서 preventDefault 되어야 함.
      // fireEvent.click 의 반환값(true=계속, false=preventDefault) 으로 검증.
      const continued = fireEvent.click(link);
      expect(continued).toBe(false);
    });

    it("givenClick_whenStateUpdates_thenDisabledFlagAppliedSynchronouslyAfterClick", () => {
      render(<LoginPage />);
      const link = screen.getByRole("link", { name: /Riot 로 로그인/ });
      fireEvent.click(link);
      expect(link.getAttribute("aria-disabled")).toBe("true");
    });

    it("givenLoadingState_whenPageShowEventFired_thenLoadingResetToIdle", () => {
      render(<LoginPage />);
      const link = screen.getByRole("link", { name: /Riot 로 로그인/ });
      fireEvent.click(link);
      expect(link).toHaveAttribute("aria-disabled", "true");
      // pageshow dispatch (PageTransitionEvent 가 jsdom 에 없을 수 있어 Event fallback)
      const evt =
        typeof PageTransitionEvent !== "undefined"
          ? new PageTransitionEvent("pageshow", { persisted: true })
          : new Event("pageshow");
      act(() => {
        window.dispatchEvent(evt);
      });
      expect(link).not.toHaveAttribute("aria-disabled", "true");
      expect(link).toHaveTextContent(/Riot 로 로그인/);
    });

    it("givenLoginPage_whenRendered_thenFanMadeNoticePresent", () => {
      render(<LoginPage />);
      expect(screen.getByText(/팬메이드 프로젝트/)).toBeInTheDocument();
    });
  });
});

describe("Feature: 로그인 에러 쿼리 표면화", () => {
  it("givenErrorQueryMfaRequired_whenRendered_thenShowsKoreanBannerAndRetry", () => {
    mockUseSearchParams("error=mfa_required");
    render(<LoginPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(/2단계 인증이 필요합니다/);
    const retry = screen.getAllByRole("link", { name: /다시 시도/ })[0];
    expect(retry).toHaveAttribute("href", "/api/auth/start");
  });

  it("givenUnknownErrorCode_whenRendered_thenFallbackMessageAndWarnLogged", () => {
    mockUseSearchParams("error=<script>alert(1)</script>");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<LoginPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(/일시적인 문제가 발생했습니다/);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("unknownErrorCode"));
  });

  it("givenNoErrorQuery_whenRendered_thenNoAlertBanner", () => {
    mockUseSearchParams("");
    render(<LoginPage />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("givenErrorQueryWithHtml_whenRendered_thenContentEscapedNotInjected", () => {
    mockUseSearchParams("error=%3Cimg+src%3Dx+onerror%3Dalert(1)%3E");
    const { container } = render(<LoginPage />);
    expect(container.querySelector("img")).toBeNull();
  });

  it.each([
    ["state_mismatch", /보안 검증/],
    ["invalid_credentials", /계정 정보가 올바르지 않/],
    ["mfa_required", /2단계 인증/],
    ["upstream", /라이엇 서버/],
    ["timeout", /응답 시간이 초과/],
    ["rate_limited", /잠시 후 다시/],
    ["unknown", /일시적인 문제/],
  ])("givenErrorCode_%s_whenRendered_thenMessageMatches", (code, pattern) => {
    mockUseSearchParams(`error=${code}`);
    render(<LoginPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(pattern);
  });
});
