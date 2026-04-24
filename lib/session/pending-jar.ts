/**
 * Plan 0020 Phase 4: lib/session/pending-jar.ts
 *
 * MFA 중간상태 쿠키(stateless jar) 인코딩/디코딩
 * PENDING_ENC_KEY로 암호화하여 키 분리 (blast radius 최소화)
 */

import { encryptWithKey, decryptWithKey, getPendingKey } from "./crypto";

/**
 * Plan 0020: Pending jar TTL (10분)
 */
export const PENDING_JAR_TTL_SEC = 600;

/**
 * Plan 0020: PendingCookie 타입
 */
export type PendingCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
};

/**
 * Plan 0020: PendingJar 타입
 */
export type PendingJar = PendingCookie[];

/**
 * Plan 0020: PendingJarPayload (내부)
 */
type PendingJarPayload = {
  jar: PendingJar;
  username: string;
  exp: number;
};

/**
 * Plan 0020: PendingJar 인코딩
 *
 * @param jar - 쿠키 배열
 * @param username - 사용자 이름
 * @returns 암호화된 base64 blob
 */
export async function encodePendingJar(
  jar: PendingJar,
  username: string
): Promise<string> {
  const key = await getPendingKey();
  const payload: PendingJarPayload = {
    jar,
    username,
    exp: Math.floor(Date.now() / 1000) + PENDING_JAR_TTL_SEC,
  };
  return encryptWithKey(JSON.stringify(payload), key);
}

/**
 * Plan 0020: PendingJar 디코딩
 *
 * @param blob - 암호화된 base64 blob
 * @returns 디코딩된 jar와 username, 또는 null (만료/손상/키 불일치)
 */
export async function decodePendingJar(
  blob: string
): Promise<{ jar: PendingJar; username: string } | null> {
  const key = await getPendingKey();

  // 복호화 실패 → null
  const plaintext = await decryptWithKey(blob, key);
  if (plaintext === null) {
    return null;
  }

  // JSON 파싱 실패 → null
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return null;
  }

  // 구조 검증
  if (!isPendingJarPayload(parsed)) {
    return null;
  }

  // 만료 검증
  const now = Math.floor(Date.now() / 1000);
  if (parsed.exp <= now) {
    return null;
  }

  return {
    jar: parsed.jar,
    username: parsed.username,
  };
}

/**
 * Plan 0020: PendingJarPayload 타입 가드
 */
function isPendingJarPayload(v: unknown): v is PendingJarPayload {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;

  // jar 검증
  if (!Array.isArray(o.jar)) return false;
  for (const cookie of o.jar) {
    if (!cookie || typeof cookie !== "object") return false;
    const c = cookie as Record<string, unknown>;
    if (typeof c.name !== "string") return false;
    if (typeof c.value !== "string") return false;
    if (c.domain !== undefined && typeof c.domain !== "string") return false;
    if (c.path !== undefined && typeof c.path !== "string") return false;
  }

  // username 검증
  if (typeof o.username !== "string") return false;

  // exp 검증
  if (typeof o.exp !== "number") return false;

  return true;
}
