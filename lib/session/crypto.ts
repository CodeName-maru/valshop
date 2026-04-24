/**
 * Session Crypto Helper
 *
 * Plan 0011: AES-GCM 배선 — 세션 쿠키 payload 를 `TOKEN_ENC_KEY`(32B base64) 로
 * 암/복호화하는 단일 진입점. `lib/crypto/aes-gcm.ts` 의 저수준 primitive 재사용.
 *
 * - `getSessionKey()`: 모듈 스코프 Promise 캐시로 요청당 importKey 비용 제거
 * - `encryptSession(payload)`: JSON.stringify → AES-GCM encrypt → base64
 * - `decryptSession(ct)`: base64 → AES-GCM decrypt → JSON.parse + 필수 필드 검증
 */

import { encrypt, decrypt, loadKeyFromEnv } from "@/lib/crypto/aes-gcm";
import type { SessionPayload } from "./types";

let cachedKey: Promise<CryptoKey> | null = null;

/**
 * `TOKEN_ENC_KEY` 환경변수에서 AES-GCM 키를 로드한다.
 * 최초 호출 시 importKey 를 수행하고 그 Promise 를 캐시한다.
 * 실패(env 부재/길이 오류) 시 캐시에 저장하지 않고 throw.
 */
export function getSessionKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const p = loadKeyFromEnv();
  // 실패를 캐시하지 않도록 실패 시 캐시 무효화
  p.catch(() => {
    if (cachedKey === p) cachedKey = null;
  });
  cachedKey = p;
  return p;
}

/**
 * SessionPayload → AES-GCM 암호문(base64)
 */
export async function encryptSession(payload: SessionPayload): Promise<string> {
  const key = await getSessionKey();
  return encrypt(JSON.stringify(payload), key);
}

/**
 * AES-GCM 암호문(base64) → SessionPayload
 * 복호화 실패/JSON 오류/필수 필드 누락 시 throw.
 */
export async function decryptSession(ciphertext: string): Promise<SessionPayload> {
  const key = await getSessionKey();
  const plaintext = await decrypt(ciphertext, key);
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new Error("Invalid session payload: not JSON");
  }
  if (!isSessionPayload(parsed)) {
    throw new Error("Invalid session payload: missing required fields");
  }
  return parsed;
}

/**
 * 세션 만료 여부 (expiresAt 은 Unix seconds 기준).
 * guard/reader 중복을 제거해 단위(sec vs ms) drift 를 방지한다.
 */
export function isSessionExpired(payload: SessionPayload, nowMs: number = Date.now()): boolean {
  const nowSec = Math.floor(nowMs / 1000);
  return payload.expiresAt <= nowSec;
}

/**
 * 테스트 전용 캐시 리셋 헬퍼. production 에서는 no-op.
 */
export function resetKeyCacheForTest(): void {
  if (process.env.NODE_ENV === "production") return;
  cachedKey = null;
}

function isSessionPayload(v: unknown): v is SessionPayload {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.puuid === "string" &&
    typeof o.accessToken === "string" &&
    typeof o.entitlementsJwt === "string" &&
    typeof o.expiresAt === "number" &&
    typeof o.region === "string"
  );
}
