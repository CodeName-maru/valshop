import type { AuthErrorCode } from "@/lib/riot/errors";

/**
 * AuthErrorCode → 한국어 에러 메시지 매핑
 *
 * spec § 5의 8종 enum을 완전 커버합니다.
 * mfa_required는 상태 전이 트리거이므로 메시지는 미사용(빈 문자열).
 */
export const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  invalid_credentials:
    "계정 정보가 올바르지 않습니다. 다시 확인해 주세요.",
  mfa_required: "", // 상태 전이 트리거, 메시지 미사용
  mfa_invalid: "인증 코드가 올바르지 않습니다.",
  mfa_expired:
    "세션이 만료되어 처음부터 다시 진행해 주세요.",
  rate_limited: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
  riot_unavailable:
    "라이엇 서버에 일시적인 문제가 발생했습니다.",
  session_expired: "세션이 만료되었습니다. 다시 로그인해 주세요.",
  unknown: "알 수 없는 오류가 발생했습니다. 다시 시도해 주세요.",
};

/**
 * 네트워크 에러 메시지 (클라이언트 전용 의사 코드)
 */
export const NETWORK_ERROR_MESSAGE =
  "네트워크 오류가 발생했습니다. 연결 상태를 확인하고 다시 시도해 주세요.";
