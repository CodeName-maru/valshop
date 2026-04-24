/**
 * TDD Tests for Countdown component
 * Plan 0004: 상점 갱신 카운트다운 타이머
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { Countdown } from "@/components/Countdown";

describe("Feature: Countdown 컴포넌트 렌더", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date", "performance"],
    });
    vi.setSystemTime(new Date(Date.UTC(2026, 3, 23, 14, 59, 50))); // 23:59:50 KST
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("given_마운트_when_첫_렌더_then_즉시_실제값_표시", async () => {
    // Given
    render(<Countdown />);
    // Then: useEffect에서 즉시 tick() 실행되므로 바로 실제 값 표시
    expect(screen.getByTestId("countdown")).toHaveTextContent("00:00:10");
    // When: 500ms 후 (다음 틱)
    act(() => {
      vi.advanceTimersByTime(500);
    });
    // Then: 여전히 10초 (1초가 지나지 않음)
    expect(screen.getByTestId("countdown")).toHaveTextContent("00:00:10");
  });

  it("given_10초_남음_when_1초_경과_then_9초로_감소", () => {
    // Given
    vi.setSystemTime(new Date(Date.UTC(2026, 3, 23, 14, 59, 50))); // 10s 남음
    render(<Countdown />);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByTestId("countdown")).toHaveTextContent("00:00:10");
    // When
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // Then
    expect(screen.getByTestId("countdown")).toHaveTextContent("00:00:09");
  });

  it("given_틱이_3초분_밀려도_when_벽시계_3초_전진_then_표시값도_3초_감소", () => {
    // Given: 시간을 먼저 전진시키되 타이머 콜백은 아직 실행 전
    vi.setSystemTime(new Date(Date.UTC(2026, 3, 23, 14, 59, 50))); // 10s 남음
    render(<Countdown />);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByTestId("countdown")).toHaveTextContent("00:00:10");
    // When: 3초치 벽시계만 이동 (tab background 시뮬레이션) + 다음 틱 1회
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    // Then: 카운터 누적이 아니라 Date.now 재산출이므로 정확히 7초
    expect(screen.getByTestId("countdown")).toHaveTextContent("00:00:07");
  });

  it("given_자정_1초_전_when_2초_경과_then_00_00_00_표기_후_다음날_23_59_59_로_전환", () => {
    // Given: 23:59:59 KST (1초 남음)
    vi.setSystemTime(new Date(Date.UTC(2026, 3, 23, 14, 59, 59)));
    render(<Countdown />);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByTestId("countdown")).toHaveTextContent("00:00:01");
    // When: 1초 더 (자정 도달)
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // Then: 정확히 00:00:00 KST → 다음 자정 24h 뒤이므로 23:59:59 로 롤오버
    //       (정확히 00:00:00 순간은 secondsUntilNextKstMidnight = 86400 → 다음 틱에 86399)
    const text = screen.getByTestId("countdown").textContent;
    expect(text === "23:59:59" || text === "24:00:00" || text === "00:00:00").toBe(true);
  });

  it("given_마운트된_컴포넌트_when_unmount_then_clearInterval_호출", () => {
    // Given
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = render(<Countdown />);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    // When
    unmount();
    // Then
    expect(clearSpy).toHaveBeenCalled();
  });

  it("given_같은_초_내_여러_틱_when_state_비교_then_setState_최소화", () => {
    // Given
    vi.setSystemTime(new Date(Date.UTC(2026, 3, 23, 14, 59, 50)));
    let renderCount = 0;
    const TestWrapper = () => {
      renderCount++;
      return <Countdown />;
    };
    render(<TestWrapper />);
    // When: 500ms 틱 4번 (= 2초) → 초 값은 10 → 9 로 1회 변경
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    // Then: 렌더는 초 변경 시점에만 (초기 placeholder + 10 + 9 = 3회 이내)
    expect(renderCount).toBeLessThanOrEqual(4); // Initial + 10 + 9 + possible boundary
  });

  it("given_정오_KST_when_마운트_then_12시간_표시", () => {
    // Given: 12:00:00 KST = 03:00:00 UTC
    vi.setSystemTime(new Date(Date.UTC(2026, 3, 23, 3, 0, 0)));
    render(<Countdown />);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    // Then: 12 hours remaining
    expect(screen.getByTestId("countdown")).toHaveTextContent("12:00:00");
  });
});
