/**
 * Session Guard
 *
 * Plan 0011: AES-GCM 복호화 배선.
 * - 쿠키 부재 / 복호화 실패(레거시 평문 포함) / 만료 → UNAUTHENTICATED throw
 * - 성공 → SessionPayload 반환
 */

import { cookies } from "next/headers";
import type { SessionPayload } from "./types";
import { decryptSession } from "./crypto";

/**
 * 세션이 필요한 페이지에서 호출.
 * 실패 시 Error("UNAUTHENTICATED") throw (호출부 redirect 위임).
 */
export async function requireSession(): Promise<SessionPayload> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session");

  if (!sessionCookie) {
    throw new Error("UNAUTHENTICATED");
  }

  let payload: SessionPayload;
  try {
    payload = await decryptSession(sessionCookie.value);
  } catch {
    throw new Error("UNAUTHENTICATED");
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.expiresAt <= nowSec) {
    throw new Error("UNAUTHENTICATED");
  }

  return payload;
}

/**
 * nullable 세션 조회
 */
export async function getSession(): Promise<SessionPayload | null> {
  try {
    return await requireSession();
  } catch {
    return null;
  }
}
