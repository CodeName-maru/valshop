/**
 * RiotFetcher 포트
 * Plan 0006에서 정의한 포트 인터페이스
 */

import type { SessionPayload } from "@/lib/session/types";

/**
 * Riot API 에러 코드 (Plan 0006 표준)
 */
export type RiotErrorCode =
  | "TOKEN_EXPIRED"
  | "RIOT_5XX"
  | "RIOT_RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "UNAUTHENTICATED";

/**
 * Riot API 에러
 */
export class RiotApiError extends Error {
  code: RiotErrorCode;

  constructor(code: RiotErrorCode, message: string) {
    super(message);
    this.name = "RiotApiError";
    this.code = code;
  }
}

/**
 * RiotFetcher 포트 인터페이스
 * Plan 0006에서 정의하며, 재시도/헤더/에러 매핑을 담당
 */
export interface RiotFetcher {
  get(url: string, session: SessionPayload): Promise<unknown>;
}
