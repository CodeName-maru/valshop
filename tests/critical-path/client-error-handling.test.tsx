import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ErrorBoundary from "@/components/ErrorBoundary";
import StoreErrorView from "@/components/StoreErrorView";

beforeEach(() => {
  // window.location 모킹
  delete (global.window as any).location;
  global.window.location = { assign: vi.fn() } as any;
  // global fetch 모킹
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Feature: 401 자동 재로그인", () => {
  it("given401FromApiStore_whenDashboardFetches_thenRedirectsToLogin", async () => {
    // Given: fetch가 401 응답 반환
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ code: "TOKEN_EXPIRED", message: "로그인 세션이 만료되었습니다." }),
    } as Response);

    // When: DashboardClient 렌더
    const DashboardClient = (await import("@/app/(app)/dashboard/DashboardClient")).default;
    render(<DashboardClient />);

    // Then: window.location.assign("/login") 호출됨
    await waitFor(() => {
      expect(global.window.location.assign).toHaveBeenCalledWith("/login");
    });
  });
});

describe("Feature: 429/5xx 에러 UI + 재시도", () => {
  it("given500FromApiStore_whenDashboardRenders_thenShowsErrorAndRetryButton", async () => {
    // Given: fetch가 502 응답 반환
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({ code: "SERVER_ERROR", message: "서버에 일시적인 문제가 발생했습니다." }),
    } as Response);

    // When: DashboardClient 렌더
    const DashboardClient = (await import("@/app/(app)/dashboard/DashboardClient")).default;
    render(<DashboardClient />);

    // Then: getByRole("alert"), getByRole("button", { name: /다시 시도/ }
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /다시 시도/ })).toBeInTheDocument();
    });
  });

  it("given429_whenUserClicksRetry_thenSingleRefetch", async () => {
    // Given: 첫 호출 429, 두 번째 200
    let callCount = 0;
    vi.mocked(global.fetch).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: false,
          status: 429,
          json: async () => ({ code: "RATE_LIMITED", message: "너무 많은 요청을 보냈습니다." }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ cards: [] }),
      } as Response;
    });

    // When: DashboardClient 렌더
    const DashboardClient = (await import("@/app/(app)/dashboard/DashboardClient")).default;
    render(<DashboardClient />);

    // 첫 429 응답 대기
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /다시 시도/ })).toBeInTheDocument();
    });

    // When: click "다시 시도"
    fireEvent.click(screen.getByRole("button", { name: /다시 시도/ }));

    // Then: 호출 횟수 === 2 (자동 재시도 없음)
    await waitFor(() => {
      expect(callCount).toBe(2);
    });
  });
});

describe("Feature: ErrorBoundary crash 차단", () => {
  it("givenRenderThrows_whenInBoundary_thenFallbackUIRenders", () => {
    // Given: <ThrowComponent /> 가 throw
    const ThrowComponent = () => {
      throw new Error("Test error");
    };

    // When: <ErrorBoundary><ThrowComponent/></ErrorBoundary> 렌더
    const { container } = render(
      <ErrorBoundary fallback={<div data-testid="error-fallback">문제가 발생했습니다</div>}>
        <ThrowComponent />
      </ErrorBoundary>,
    );

    // Then: fallback UI ("문제가 발생했습니다") 표시, 앱 전체 crash 없음
    expect(screen.getByTestId("error-fallback")).toBeInTheDocument();
    expect(screen.getByTestId("error-fallback")).toHaveTextContent("문제가 발생했습니다");
  });
});

describe("Feature: StoreErrorView 에러 UI", () => {
  it("givenServerErrorCode_whenRender_thenShowsErrorAndRetryButton", () => {
    // Given: SERVER_ERROR 코드
    const onRetry = vi.fn();

    // When: render
    render(<StoreErrorView code="SERVER_ERROR" onRetry={onRetry} />);

    // Then: getByRole("alert"), getByRole("button", { name: /다시 시도/ }
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /다시 시도/ })).toBeInTheDocument();
  });

  it("givenRateLimitedCode_whenRender_thenShowsRateLimitedMessage", () => {
    render(<StoreErrorView code="RATE_LIMITED" onRetry={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("너무 많은 요청");
  });

  it("givenTokenExpiredCode_whenRender_thenShowsTokenExpiredMessage", () => {
    render(<StoreErrorView code="TOKEN_EXPIRED" onRetry={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("로그인 세션이 만료");
  });

  it("givenUserClicksRetry_whenButtonClicked_thenCallsOnRetry", () => {
    const onRetry = vi.fn();

    render(<StoreErrorView code="SERVER_ERROR" onRetry={onRetry} />);

    // When: click "다시 시도"
    fireEvent.click(screen.getByRole("button", { name: /다시 시도/ }));

    // Then: onRetry 호출됨
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
