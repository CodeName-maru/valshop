"use client";

/**
 * RetryButton - 클라이언트 아일랜드 컴포넌트
 *
 * Plan 0025: SSR 페이지 재시도 버튼
 * - router.refresh()로 서버 컴포넌트 재실행
 * - /api/store 호출 없이 동일 SSR 경로 재사용
 */

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function RetryButton() {
  const router = useRouter();

  const handleRetry = () => {
    router.refresh();
  };

  return (
    <Button
      onClick={handleRetry}
      variant="outline"
      data-testid="retry-button"
    >
      재시도
    </Button>
  );
}
