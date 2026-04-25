/**
 * StoreErrorView - 스킨 카드 조회 에러 표시 컴포넌트
 *
 * RiotError 코드별 한국어 메시지와 재시도 버튼을 제공합니다.
 * NFR Availability: crash 없는 복구 가능한 UI
 */

import React from "react";

type RiotErrorCode =
  | "TOKEN_EXPIRED"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "CLIENT_VERSION_MISMATCH"
  | "UPSTREAM_UNAVAILABLE"
  | "AUTH_FAILED";

interface Props {
  code: RiotErrorCode;
  onRetry: () => void;
}

const ERROR_MESSAGES: Record<RiotErrorCode, string> = {
  TOKEN_EXPIRED: "로그인 세션이 만료되었습니다. 다시 로그인해주세요.",
  RATE_LIMITED: "너무 많은 요청을 보냈습니다. 잠시 후 다시 시도해주세요.",
  SERVER_ERROR: "서버에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.",
  CLIENT_VERSION_MISMATCH:
    "클라이언트 버전이 업데이트되었습니다. 페이지를 새로고침해주세요.",
  UPSTREAM_UNAVAILABLE:
    "서버에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.",
  AUTH_FAILED: "로그인 중 오류가 발생했습니다. 다시 시도해주세요.",
};

export default function StoreErrorView({ code, onRetry }: Props) {
  const message = ERROR_MESSAGES[code] || ERROR_MESSAGES.SERVER_ERROR;

  // 401 (TOKEN_EXPIRED) 는 자동 리다이렉트하므로 재시도 버튼을 보여주지 않음
  if (code === "TOKEN_EXPIRED") {
    return (
      <div
        role="alert"
        className="flex min-h-screen items-center justify-center bg-gray-50"
      >
        <div className="rounded-lg bg-white p-8 text-center shadow-lg">
          <h2 className="mb-4 text-xl font-bold text-gray-900">
            세션 만료
          </h2>
          <p className="text-gray-600">{message}</p>
          <p className="mt-4 text-sm text-gray-500">
            로그인 페이지로 이동합니다...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="flex min-h-screen items-center justify-center bg-gray-50"
    >
      <div className="rounded-lg bg-white p-8 text-center shadow-lg">
        <h2 className="mb-4 text-xl font-bold text-gray-900">문제가 발생했습니다</h2>
        <p className="mb-6 text-gray-600">{message}</p>
        <button
          onClick={onRetry}
          className="rounded-md bg-blue-600 px-6 py-2 font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          다시 시도
        </button>
      </div>
    </div>
  );
}
