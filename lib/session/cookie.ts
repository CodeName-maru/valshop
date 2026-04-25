/**
 * Session Cookie Builder
 *
 * Plan 0011: AES-GCM 암호화 배선 완료.
 * payload 를 `encryptSession()` 로 암호화한 뒤 Set-Cookie 헤더를 조립한다.
 */

/* eslint-disable @typescript-eslint/no-deprecated -- 이 파일은 SessionPayload 기반 MVP cookie 세션 구현체. ResolvedSession 으로의 마이그레이션은 ADR-0002 Phase 2 (Supabase user_tokens) 완료 후 진행. */
import type { SessionPayload } from "./types";
import { encryptSession } from "./crypto";

/**
 * Build Set-Cookie header value for session cookie.
 * Max-Age 는 expiresAt 과 현재 시각 차이로 동적 계산한다.
 * 반환값은 AES-GCM 암호문(base64) 을 담은 `session=<ct>; ...` 헤더.
 */
export async function buildSessionCookie(payload: SessionPayload): Promise<string> {
  const maxAge = Math.max(0, payload.expiresAt - Math.floor(Date.now() / 1000));
  const value = await encryptSession(payload);
  return `session=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${String(maxAge)}`;
}
