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

  // document.cookie 만료 세팅 (session 쿠키 파기)
  // 동일 name/path/domain에 Max-Age=0으로 설정하여 브라우저가 삭제하도록 함
  document.cookie =
    "session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax";
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
      router.push("/login");
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
