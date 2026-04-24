"use client";

/**
 * 로그아웃 버튼 컴포넌트
 *
 * - 클릭 시 로컬 토큰 파기 (localStorage, cookie)
 * - 서버 로그아웃 API 호출 (실패해도 진행)
 * - /login으로 리다이렉트
 * - 오프라인에서도 로컬 파기 보장
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

// shadcn/ui Button이 없으면 간단한 구현 사용
// ADR-0007에 따라 shadcn/ui 사용

function clearLocalTokens(): void {
  // localStorage에서 val_* 프리픽스 키 제거
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith("val_")) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => localStorage.removeItem(key));

  // 참고: HttpOnly 쿠키는 클라이언트에서 직접 삭제할 수 없습니다.
  // document.cookie로는 HttpOnly 아닌 쿠키만 삭제 가능하며,
  // HttpOnly 쿠키는 서버 측에서만 만료시킬 수 있습니다.
  // 따라서 /api/auth/logout 서버 API에서 HttpOnly 쿠키를 제거해야 합니다.
}

export function LogoutButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const handleLogout = async () => {
    if (isPending) return;

    setIsPending(true);

    try {
      // 1. 로컬 토큰 선제 파기 (Availability NFR: 오프라인에서도 보장)
      clearLocalTokens();

      // 2. 서버 로그아웃 시도 (실패해도 진행)
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: {
            Accept: "application/json",
          },
        });
      } catch {
        // 네트워크 실패 시 무시하고 진행 (이미 로컬 파기 완료)
      }

      // 3. /login으로 리다이렉트
      router.push("/login" as const);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Button
      variant="ghost"
      onClick={handleLogout}
      disabled={isPending}
      aria-label="로그아웃"
    >
      <LogOut className="h-4 w-4" />
      <span className="sr-only">로그아웃</span>
    </Button>
  );
}
