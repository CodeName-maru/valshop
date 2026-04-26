/**
 * StoreErrorState 컴포넌트
 * 상점 로딩 실패 시 에러 상태 표시
 *
 * Plan 0025: RetryButton 사용으로 변경
 */

"use client";

import { RetryButton } from "@/app/(app)/dashboard/RetryButton";

interface StoreErrorStateProps {
  error?: string;
}

export function StoreErrorState({ error = "상점 정보를 불러올 수 없습니다." }: StoreErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 bg-white rounded-lg border">
      <p className="text-slate-600 mb-4">{error}</p>
      <RetryButton />
    </div>
  );
}
