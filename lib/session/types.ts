/**
 * Session 도메인 타입
 * Plan 0002 (FR-1/FR-2)에서 정의된 세션 페이로드
 */

/**
 * 세션 페이로드 타입
 */
export type SessionPayload = {
  puuid: string;
  accessToken: string;
  entitlementsJwt: string;
  expiresAt: number;
  region: string;
};
