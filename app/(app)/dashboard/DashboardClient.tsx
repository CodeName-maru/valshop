"use client";

/**
 * DashboardClient - 대시보드 클라이언트 컴포넌트
 *
 * 스킨 카드를 조회하고 에러 처리를 수행합니다.
 * Phase 4: 401 시 자동 재로그인, 429/5xx 시 에러 UI + 재시도 버튼
 */

import { useEffect, useState } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";
import StoreErrorView from "@/components/StoreErrorView";

type RiotErrorCode =
  | "TOKEN_EXPIRED"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "CLIENT_VERSION_MISMATCH"
  | "UPSTREAM_UNAVAILABLE"
  | "AUTH_FAILED";

interface ErrorResponse {
  code: RiotErrorCode;
  message: string;
}

interface SkinCard {
  id: string;
  name: string;
  // 기타 필드 (Plan 0003에서 정의)
}

function DashboardContent() {
  const [skins, setSkins] = useState<SkinCard[]>([]);
  const [error, setError] = useState<ErrorResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSkins = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/store");

      if (!response.ok) {
        // 비-2xx 응답은 JSON 이 아닐 수 있다 (HTML 5xx, empty body 등).
        // parse 실패 시 generic upstream error 로 처리한다.
        let body: { code?: string; message?: string } = {};
        try {
          body = (await response.json()) as { code?: string; message?: string };
        } catch {
          body = {};
        }

        // 401 (TOKEN_EXPIRED) 는 자동 리다이렉트
        if (response.status === 401 || body.code === "TOKEN_EXPIRED") {
          window.location.assign("/login");
          return;
        }

        // 그 외 에러는 상태에 저장 (parse 실패 / 알 수 없는 code 는 SERVER_ERROR fallback)
        const code = (body.code as RiotErrorCode | undefined) ?? "SERVER_ERROR";
        const message =
          body.message ??
          "서버에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.";
        setError({ code, message });
        return;
      }

      const data = (await response.json()) as { cards?: SkinCard[] };
      setSkins(data.cards ?? []);
    } catch (err) {
      // 네트워크 에러 등
      setError({
        code: "SERVER_ERROR",
        message: "서버에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSkins();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-600">로딩 중...</p>
      </div>
    );
  }

  if (error) {
    return <StoreErrorView code={error.code} onRetry={fetchSkins} />;
  }

  return (
    <div>
      <h2 className="mb-4 text-2xl font-bold">스킨 카드</h2>
      {skins.length === 0 ? (
        <p className="text-gray-600">표시할 스킨이 없습니다.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {skins.map((skin) => (
            <div
              key={skin.id}
              className="rounded-lg border bg-white p-4 shadow-sm"
            >
              <h3 className="font-medium">{skin.name}</h3>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DashboardClient() {
  return (
    <ErrorBoundary
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="rounded-lg bg-white p-8 shadow-lg">
            <h2 className="text-xl font-bold">문제가 발생했습니다</h2>
            <p className="mt-2 text-gray-600">
              페이지를 새로고침해주세요.
            </p>
          </div>
        </div>
      }
    >
      <DashboardContent />
    </ErrorBoundary>
  );
}
