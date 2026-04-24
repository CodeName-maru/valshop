"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { useSearchParams } from "next/navigation";

// Plan 0006 Phase 5-3 화이트리스트와 동일 키. 신규 코드 추가 시 양쪽 grep 동기화 필요.
const ERROR_MESSAGES: Record<string, string> = {
  state_mismatch: "보안 검증에 실패했습니다. 다시 시도해 주세요.",
  invalid_credentials: "계정 정보가 올바르지 않습니다. 다시 확인해 주세요.",
  mfa_required: "2단계 인증이 필요합니다. 인증 후 다시 시도해 주세요.",
  upstream: "라이엇 서버와 통신할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  timeout: "응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.",
  rate_limited: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
  unknown: "일시적인 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
};

export default function LoginPage() {
  const searchParams = useSearchParams();
  const errorCode = searchParams?.get("error") ?? null;

  const [loading, setLoading] = useState(false);

  // bfcache 복귀 시 disabled 잔존 방지
  useEffect(() => {
    const onShow = () => setLoading(false);
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  // 화이트리스트 외 코드일 때 console.warn
  useEffect(() => {
    if (errorCode && !ERROR_MESSAGES[errorCode]) {
      console.warn(`unknownErrorCode: ${errorCode}`);
    }
  }, [errorCode]);

  const message = errorCode
    ? ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.unknown
    : null;

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (loading) {
      e.preventDefault();
      return;
    }
    setLoading(true);
    // default navigation 진행 — preventDefault 호출하지 않음
  };

  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center">
            <h1 className="text-3xl font-bold">VAL-Shop</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              라이엇 게임즈 계정으로 로그인하세요
            </p>
          </div>

          <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
            {message ? (
              <div
                role="alert"
                className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              >
                <p>{message}</p>
                <a
                  href="/api/auth/start"
                  className="mt-2 inline-block text-xs underline"
                >
                  다시 시도
                </a>
              </div>
            ) : null}

            <a
              href="/api/auth/start"
              onClick={handleClick}
              aria-disabled={loading}
              className={`flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 ${
                loading ? "pointer-events-none opacity-60" : ""
              }`}
            >
              {loading ? "이동 중…" : "Riot 로 로그인"}
            </a>

            <div className="mt-4 text-center text-xs text-muted-foreground">
              VAL-Shop은 라이엇 게임즈와 무관한 팬메이드 프로젝트입니다.
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
