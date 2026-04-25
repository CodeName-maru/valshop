"use client";

/**
 * 상점 갱신 카운트다운 컴포넌트
 * Plan 0004: 상점 갱신 카운트다운 타이머
 * Plan 0017 P2-#3: onComplete 콜백 (1회 보장, endsAtEpochMs 모드 한정)
 *
 * 매일 00:00 KST 발로란트 상점 로테이션까지 남은 시간을 실시간 표시
 * 또는 야시장 종료 시간까지 카운트다운
 */

import { useState, useEffect, useRef } from "react";
import { secondsUntilNextKstMidnight, formatHms } from "@/lib/time/countdown";

export interface CountdownProps {
  /** Optional end timestamp (epoch ms) for custom countdown (e.g., night market) */
  endsAtEpochMs?: number;
  /** Optional callback for testing/render tracking */
  onRender?: () => void;
  /**
   * Called exactly once when remaining reaches 0.
   * Only invoked when `endsAtEpochMs` is provided (KST midnight 모드는 "완료" 개념이 없으므로 무시).
   */
  onComplete?: () => void;
}

const TICK_INTERVAL_MS = 500;

export function Countdown({ endsAtEpochMs, onRender, onComplete }: CountdownProps) {
  const [display, setDisplay] = useState<string>("--:--:--");
  const firedRef = useRef<boolean>(false);

  useEffect(() => {
    // endsAtEpochMs 가 변경되면 onComplete 게이트를 리셋한다.
    firedRef.current = false;

    const tick = () => {
      const now = Date.now();
      let remaining: number;

      if (endsAtEpochMs !== undefined) {
        // Custom countdown to specific timestamp
        remaining = Math.max(0, Math.floor((endsAtEpochMs - now) / 1000));
      } else {
        // Default: next KST midnight rotation
        remaining = secondsUntilNextKstMidnight(now);
      }

      const next = formatHms(remaining);
      setDisplay((prev) => (prev === next ? prev : next));

      // onComplete 는 endsAtEpochMs 모드에서만, 0 도달 시 정확히 1회.
      if (endsAtEpochMs !== undefined && remaining === 0 && !firedRef.current) {
        firedRef.current = true;
        onComplete?.();
      }
    };

    // First tick immediately
    tick();

    const id = setInterval(tick, TICK_INTERVAL_MS);

    return () => { clearInterval(id); };
  }, [endsAtEpochMs, onComplete]);

  onRender?.();

  return (
    <span data-testid="countdown" className="font-mono tabular-nums text-2xl">
      {display}
    </span>
  );
}
