/**
 * StoreErrorState 컴포넌트
 * 상점 로딩 실패 시 에러 상태 표시
 */

"use client";

import { Button } from "@/components/ui/button";

interface StoreErrorStateProps {
  error?: string;
}

export function StoreErrorState({ error = "상점 정보를 불러올 수 없습니다." }: StoreErrorStateProps) {
  const handleRetry = () => {
    window.location.reload();
  };

  return (
    <div className="flex flex-col items-center justify-center p-8 bg-white rounded-lg border">
      <p className="text-slate-600 mb-4">{error}</p>
      <Button onClick={handleRetry} variant="outline">
        다시 시도
      </Button>
    </div>
  );
}
