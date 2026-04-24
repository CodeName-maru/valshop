/**
 * 쿠키 관련 유틸리티
 *
 * Plan 0011: AES-GCM 배선 — session 쿠키 복호화 후 puuid(userId semantic) 반환.
 * 복호화 실패/만료/쿠키 부재 → null (호출부 graceful 처리).
 */

import { decryptSession } from "@/lib/session/crypto";

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
 * 요청의 Cookie 헤더에서 session 쿠키를 읽어 userId(=puuid) 를 복원.
 *
 * - 쿠키 부재 → null
 * - 복호화 실패(레거시 평문/tamper/wrong key) → null (crash 금지, 재로그인 유도)
 * - 만료(expiresAt ≤ now) → null
 */
export async function readSessionFromCookies(
  cookieHeader: string | null
): Promise<string | null> {
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(";").reduce<Record<string, string>>(
    (acc, pair) => {
      const idx = pair.indexOf("=");
      if (idx === -1) return acc;
      const key = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (key) acc[key] = value;
      return acc;
    },
    {}
  );

  const session = cookies[SESSION_COOKIE_NAME];
  if (!session) {
    return null;
  }

  try {
    const payload = await decryptSession(session);
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.expiresAt <= nowSec) {
      return null;
    }
    return payload.puuid;
  } catch {
    return null;
  }
}

export { SESSION_COOKIE_NAME };
