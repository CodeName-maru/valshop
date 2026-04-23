/**
 * Session Guard
 * 세션 확인 및 리다이렉트 유틸리티
 * Plan 0002 (FR-1/FR-2)에서 구현된 것으로 가정
 */

import { cookies } from "next/headers";
import type { SessionPayload } from "./types";

/**
 * 세션이 필요한 페이지에서 호출
 * 세션이 없으면 /login으로 리다이렉트
 * MVP: 간단한 구현 (Phase 2에서 암호화 적용)
 */
export async function requireSession(): Promise<SessionPayload> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session");

  if (!sessionCookie) {
    // Next.js redirect는 Error를 throw해서 처리
    throw new Error("UNAUTHENTICATED");
  }

  // MVP: 실제 복호화 없이 더미 값 반환
  // Phase 2에서는 AES-GCM 복호화 적용
  try {
    const decoded = JSON.parse(atob(sessionCookie.value));
    return decoded as SessionPayload;
  } catch {
    throw new Error("UNAUTHENTICATED");
  }
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
