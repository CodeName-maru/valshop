/**
 * 쿠키 관련 유틸리티
 */

const SESSION_COOKIE_NAME = "session";

/**
 * 로그아웃용 쿠키 헤더 생성
 * Max-Age=0으로 설정하여 브라우저가 쿠키를 즉시 삭제하도록 함
 */
export function buildLogoutCookie(): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ];

  return attributes.join("; ");
}

/**
 * 요청에서 session 쿠키를 읽어 userId를 복원
 * MVP에서는 구현이 간단하며, Phase 2에서 암호화된 토큰 복원 로직이 추가됨
 */
export function readSessionFromCookies(
  cookieHeader: string | null
): string | null {
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(";").reduce<Record<string, string>>(
    (acc, pair) => {
      const [key, value] = pair.trim().split("=");
      if (key && value) {
        acc[key] = value;
      }
      return acc;
    },
    {}
  );

  const session = cookies[SESSION_COOKIE_NAME];
  if (!session) {
    return null;
  }

  // MVP: 실제 암호화/복호화는 Plan 0002에서 구현
  // 여기서는 더미 userId를 반환 (실제로는 JWT 디코딩 등 필요)
  try {
    // 간단한 base64 디코딩 시도 (실제 구현에서는 안전한 JWT 파서 사용)
    const decoded = atob(session);
    const parsed = JSON.parse(decoded);
    return parsed.userId || null;
  } catch {
    return null;
  }
}

export { SESSION_COOKIE_NAME };
