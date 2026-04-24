/**
 * Session Crypto Helper
 *
 * Plan 0011: AES-GCM 배선 — 세션 쿠키 payload 를 `TOKEN_ENC_KEY`(32B base64) 로
 * 암/복호화하는 단일 진입점. `lib/crypto/aes-gcm.ts` 의 저수준 primitive 재사용.
 *
 * Plan 0020: 이중 키 지원 + null 반환 정규화
 * - `TOKEN_ENC_KEY`: DB 토큰 컬럼 암호화
 * - `PENDING_ENC_KEY`: auth_pending cookie 암호화 (키 분리로 blast radius 최소화)
 * - `decryptWithKey()`: GCM 실패 시 null 반환 (throw 금지 - oracle 방지)
 * - 환경변수 부재는 throw (config error) vs 복호화 실패는 null (data error) 구분
 *
 * - `getSessionKey()`: @deprecated `getTokenKey` 사용 권장 (하위 호환 유지)
 * - `getTokenKey()`: TOKEN_ENC_KEY 로드 + 모듈 캐시
 * - `getPendingKey()`: PENDING_ENC_KEY 로드 + 모듈 캐시
 * - `encryptSession(payload)`: JSON.stringify → AES-GCM encrypt → base64
 * - `decryptSession(ct)`: base64 → AES-GCM decrypt → JSON.parse + 필수 필드 검증
 */

import { encrypt, decrypt, loadKey } from "@/lib/crypto/aes-gcm";
import type { SessionPayload } from "./types";

// Plan 0020: 이중 키 캐시 (독립적 관리)
let cachedTokenKey: Promise<CryptoKey> | null = null;
let cachedPendingKey: Promise<CryptoKey> | null = null;

// Plan 0020: Near-expiry 임계값 (60s 여유)
export const NEAR_EXPIRY_THRESHOLD_SEC = 60;

// Plan 0020: Session TTL (14일)
export const SESSION_TTL_SEC = 1209600; // 14 * 24 * 60 * 60

/**
 * Plan 0020: `TOKEN_ENC_KEY` 환경변수에서 AES-GCM 키를 로드한다.
 * 최초 호출 시 importKey 를 수행하고 그 Promise 를 캐시한다.
 * 실패(env 부재/길이 오류) 시 캐시에 저장하지 않고 throw.
 */
export function getTokenKey(): Promise<CryptoKey> {
  if (cachedTokenKey) return cachedTokenKey;
  const keyBase64 = process.env.TOKEN_ENC_KEY;
  if (!keyBase64) {
    throw new Error("TOKEN_ENC_KEY environment variable is not set");
  }
  const p = loadKey(keyBase64);
  // 실패를 캐시하지 않도록 실패 시 캐시 무효화
  p.catch(() => {
    if (cachedTokenKey === p) cachedTokenKey = null;
  });
  cachedTokenKey = p;
  return p;
}

/**
 * Plan 0020: `PENDING_ENC_KEY` 환경변수에서 AES-GCM 키를 로드한다.
 * 최초 호출 시 importKey 를 수행하고 그 Promise 를 캐시한다.
 * 실패(env 부재/길이 오류) 시 캐시에 저장하지 않고 throw.
 */
export function getPendingKey(): Promise<CryptoKey> {
  if (cachedPendingKey) return cachedPendingKey;
  const keyBase64 = process.env.PENDING_ENC_KEY;
  if (!keyBase64) {
    throw new Error("PENDING_ENC_KEY environment variable is not set");
  }
  const p = loadKey(keyBase64);
  // 실패를 캐시하지 않도록 실패 시 캐시 무효화
  p.catch(() => {
    if (cachedPendingKey === p) cachedPendingKey = null;
  });
  cachedPendingKey = p;
  return p;
}

/**
 * Plan 0020: @deprecated `getTokenKey` 사용 권장 (하위 호환 유지)
 */
export function getSessionKey(): Promise<CryptoKey> {
  return getTokenKey();
}

/**
 * Plan 0020: 주어진 키로 평문 암호화
 */
export async function encryptWithKey(
  plaintext: string,
  key: CryptoKey
): Promise<string> {
  return encrypt(plaintext, key);
}

/**
 * Plan 0020: 주어진 키로 암호문 복호화
 * GCM auth tag 실패/bad key 시 null 반환 (throw 금지 - oracle 방지)
 * JSON parse 는 호출부 책임
 */
export async function decryptWithKey(
  ciphertext: string,
  key: CryptoKey
): Promise<string | null> {
  try {
    return await decrypt(ciphertext, key);
  } catch {
    // 복호화 실패: tampered, wrong key, corrupted data
    // null 반환으로 정규화 (공격자 oracle 방지 + warn 로그 분리)
    return null;
  }
}

/**
 * SessionPayload → AES-GCM 암호문(base64)
 */
export async function encryptSession(payload: SessionPayload): Promise<string> {
  const key = await getTokenKey();
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
 * Plan 0020: 테스트 전용 캐시 리셋 헬퍼 (두 키 모두 무효화)
 * production 에서는 no-op.
 */
export function resetAllKeyCachesForTest(): void {
  if (process.env.NODE_ENV === "production") return;
  cachedTokenKey = null;
  cachedPendingKey = null;
}

/**
 * @deprecated Plan 0020: `resetAllKeyCachesForTest` 사용 권장 (하위 호환 유지)
 */
export function resetKeyCacheForTest(): void {
  resetAllKeyCachesForTest();
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

/**
 * Plan 0021: JWT 디코더 (서명 검증 없이 페이로드만 파싱)
 *
 * Riot의 idToken은 이미 보안 채널(TLS)로 수신했으므로
 * 서명 검증 없이 페이로드만 추출해도 안전합니다.
 *
 * @param jwt - JWT 문자열
 * @returns 페이로드 객체 또는 null (파싱 실패)
 */
export function decodeJwt(jwt: string): Record<string, unknown> | null {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) {
      return null;
    }

    // Base64URL 디코딩
    const payloadPart = parts[1];
    if (!payloadPart) {
      return null;
    }

    const base64 = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const decoded = atob(padded);
    const json = JSON.parse(decoded);

    return json as Record<string, unknown>;
  } catch {
    return null;
  }
}
