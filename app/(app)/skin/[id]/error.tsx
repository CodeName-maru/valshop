"use client";

/**
 * Skin Detail Error Page
 * FR-9: 에러 시 사용자에게 안내하고 재시도 옵션 제공
 * Operability NFR: Next.js error boundary
 */

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log error to console (Vercel will capture this)
    console.error("Skin detail page error:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="bg-white p-8 rounded-lg shadow-md max-w-md text-center">
        <h2 className="text-2xl font-bold text-slate-900 mb-4">
          상세 정보를 불러올 수 없습니다
        </h2>
        <p className="text-slate-600 mb-6">
          스킨 정보를 가져오는 중 문제가 발생했습니다.
        </p>
        <div className="flex gap-4 justify-center">
          <button
            onClick={reset}
            className="px-4 py-2 bg-slate-900 text-white rounded-md hover:bg-slate-800 transition"
          >
            다시 시도
          </button>
          <a
            href="/dashboard"
            className="px-4 py-2 border border-slate-300 text-slate-700 rounded-md hover:bg-slate-50 transition"
          >
            대시보드로
          </a>
        </div>
      </div>
    </div>
  );
}
