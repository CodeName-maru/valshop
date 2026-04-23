import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ErrorBoundary from "@/components/ErrorBoundary";
import StoreErrorView from "@/components/StoreErrorView";

beforeEach(() => {
  // window.location 모킹
  delete (global.window as any).location;
  global.window.location = { assign: vi.fn() } as any;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Feature: ErrorBoundary crash 차단", () => {
  it("givenRenderThrows_whenInBoundary_thenFallbackUIRenders", () => {
    // Given: <SkinCard /> 가 throw
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

    // Then: getByRole("alert"), getByRole("button", { name: /다시 시도/ })
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
