"use client";

import { Suspense, useEffect, useState, type MouseEvent, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { logger } from "@/lib/logger";

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
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const searchParams = useSearchParams();
  const errorCode = searchParams?.get("error") ?? null;

  const [loading, setLoading] = useState(false);
  const [showDevToken, setShowDevToken] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [tokenSending, setTokenSending] = useState(false);

  // bfcache 복귀 시 disabled 잔존 방지
  useEffect(() => {
    const onShow = () => setLoading(false);
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  // 화이트리스트 외 코드일 때 logger.warn
  useEffect(() => {
    if (errorCode && !ERROR_MESSAGES[errorCode]) {
      logger.warn("unknownErrorCode", { errorCode });
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

  const handleTokenSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!tokenInput.trim() || tokenSending) return;

    setTokenSending(true);
    setTokenError(null);

    try {
      const res = await fetch("/api/auth/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: tokenInput.trim() }),
      });

      const data = await res.json();

      if (res.ok && data.redirect) {
        window.location.href = data.redirect;
      } else {
        setTokenError(data.error || "토큰 인증에 실패했습니다.");
        setTokenSending(false);
      }
    } catch {
      setTokenError("네트워크 오류가 발생했습니다.");
      setTokenSending(false);
    }
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

            {/* 개발용 수동 토큰 입력 */}
            <div className="mt-4 border-t border-border pt-4">
              <button
                type="button"
                onClick={() => setShowDevToken(!showDevToken)}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {showDevToken ? "▼" : "▶"} 개발용 수동 토큰 입력
              </button>

              {showDevToken ? (
                <form onSubmit={handleTokenSubmit} className="mt-3 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Riot 토큰을 직접 입력하여 로그인합니다.
                  </p>
                  <ol className="text-xs text-muted-foreground list-decimal list-inside space-y-1">
                    <li>F12 → Application → Local Storage</li>
                    <li>https://auth.riotgames.com → &quot;token&quot; 값 복사</li>
                    <li>아래에 붙여넣기</li>
                  </ol>
                  <input
                    type="text"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder="Riot access_token 붙여넣기..."
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    disabled={tokenSending}
                  />
                  {tokenError && (
                    <p className="text-xs text-destructive">{tokenError}</p>
                  )}
                  <button
                    type="submit"
                    disabled={tokenSending || !tokenInput.trim()}
                    className="w-full rounded-md bg-secondary px-3 py-2 text-sm font-medium hover:bg-secondary/80 disabled:opacity-50"
                  >
                    {tokenSending ? "인증 중..." : "토큰으로 로그인"}
                  </button>
                </form>
              ) : null}
            </div>

            <div className="mt-4 text-center text-xs text-muted-foreground">
              VAL-Shop은 라이엇 게임즈와 무관한 팬메이드 프로젝트입니다.
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
