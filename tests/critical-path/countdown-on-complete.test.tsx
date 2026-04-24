/**
 * Plan 0017 Phase 3: Countdown onComplete 콜백 (1회 보장)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { Countdown } from "@/components/Countdown";

describe("Feature: Countdown onComplete 콜백", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date", "performance"],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("given_endsAt가_3초후_when_3초_경과_then_onComplete_정확히_1회_호출", () => {
    // Given
    vi.setSystemTime(new Date(Date.UTC(2026, 3, 23, 0, 0, 0)));
    const now = Date.now();
    const onComplete = vi.fn();
    render(<Countdown endsAtEpochMs={now + 3000} onComplete={onComplete} />);
    expect(onComplete).not.toHaveBeenCalled();
    // When
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    // Then
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("given_endsAt가_이미_과거_when_마운트_then_onComplete_1회_즉시_호출", () => {
    // Given/When
    vi.setSystemTime(new Date(Date.UTC(2026, 3, 23, 0, 0, 0)));
    const onComplete = vi.fn();
    render(<Countdown endsAtEpochMs={Date.now() - 5000} onComplete={onComplete} />);
    // Then
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("given_0_도달_when_이후_여러_tick_경과_then_onComplete_여전히_1회", () => {
    // Given
    vi.setSystemTime(new Date(Date.UTC(2026, 3, 23, 0, 0, 0)));
    const onComplete = vi.fn();
    render(<Countdown endsAtEpochMs={Date.now() + 1000} onComplete={onComplete} />);
    // When
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    // Then
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("given_endsAt_미지정_when_자정_통과_then_onComplete_미호출", () => {
    // Given: 23:59:58 KST (= 14:59:58 UTC)
    vi.setSystemTime(new Date(Date.UTC(2026, 3, 23, 14, 59, 58)));
    const onComplete = vi.fn();
    render(<Countdown onComplete={onComplete} />);
    // When: 5초 진행 (자정 통과)
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    // Then
    expect(onComplete).not.toHaveBeenCalled();
  });
});
