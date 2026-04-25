/**
 * Session 도메인 타입
 * Plan 0002 (FR-1/FR-2)에서 정의된 세션 페이로드
 * Plan 0020: 세션 쿠키 재설계 이후 DB row 기반 `ResolvedSession` 선호
 */

/**
 * 세션 페이로드 타입
 * @deprecated 세션 쿠키 재설계 이후 DB row 기반 `ResolvedSession` 선호
 */
export type SessionPayload = {
  puuid: string;
  accessToken: string;
  entitlementsJwt: string;
  expiresAt: number;
  region: string;
};

/**
 * Plan 0020: ResolvedSession - resolve() 반환 타입
 * ssid 는 보안상 외부 노출 금지
 */
export type ResolvedSession = {
  puuid: string;
  accessToken: string;
  entitlementsJwt: string;
  region: string;
  accessExpiresAt: number;
};

/**
 * Plan 0020: SessionTokens - createSession 입력 DTO
 */
export type SessionTokens = {
  accessToken: string;
  entitlementsJwt: string;
  ssid: string;
  tdid?: string;
  region: string;
  accessExpiresIn: number;
};
