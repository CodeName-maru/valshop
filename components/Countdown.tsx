"use client";

/**
 * 상점 갱신 카운트다운 컴포넌트
 * Plan 0004: 상점 갱신 카운트다운 타이머
 *
 * 매일 00:00 KST 발로란트 상점 로테이션까지 남은 시간을 실시간 표시
 */

import { useState, useEffect } from "react";
import { secondsUntilNextKstMidnight, formatHms } from "@/lib/time/countdown";

export interface CountdownProps {
  /** Optional callback for testing/render tracking */
  onRender?: () => void;
}

const TICK_INTERVAL_MS = 500;

export function Countdown({ onRender }: CountdownProps) {
  const [display, setDisplay] = useState<string>("--:--:--");

  useEffect(() => {
    // Immediate tick on mount to transition from placeholder
    const tick = () => {
      const remaining = secondsUntilNextKstMidnight(Date.now());
      const next = formatHms(remaining);
      setDisplay((prev) => (prev === next ? prev : next));
    };

    // First tick immediately
    tick();

    const id = setInterval(tick, TICK_INTERVAL_MS);

    return () => clearInterval(id);
  }, []);

  onRender?.();

  return (
    <span data-testid="countdown" className="font-mono tabular-nums text-2xl">
      {display}
    </span>
  );
}
