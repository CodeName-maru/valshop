/**
 * RiotFetcher 포트
 * Plan 0006에서 정의한 포트 인터페이스
 */

import type { SessionPayload } from "@/lib/session/types";

/**
 * createRiotFetcher - RiotFetcher 인스턴스 생성 헬퍼
 * (편의 함수: httpRiotFetcher를 반환)
 */
export function createRiotFetcher(): RiotFetcher {
  return httpRiotFetcher;
}

/**
 * Riot API 에러 코드 (Plan 0006 표준)
 */
export type RiotErrorCode =
  | "TOKEN_EXPIRED"
  | "RIOT_5XX"
  | "RIOT_RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "UNAUTHENTICATED"
  | "UPSTREAM_UNAVAILABLE";

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
  get(url: string, session: SessionPayload, clientVersion: string): Promise<unknown>;
  fetch(url: string, options: RequestInit): Promise<Response>;
}

/**
 * HTTP-based RiotFetcher implementation
 */
export const httpRiotFetcher: RiotFetcher = {
  async get(url: string, session: SessionPayload, clientVersion: string): Promise<unknown> {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        "X-Riot-ClientPlatform": "ew0KCSJwbGF0Zm9ybVR5cGUiOiJQQyIsDQoJInBsYXRmb3JtT3MiOiJXaW5kb3dzIiwNCgkicGxhdGZvcm1DaGFubmVsSWQiOiJlYzZlMzliZS00YzY1LTQ1YmMtODhlZi0wY2YyNzdjMTg1NmMiLA0NCgkicGxhdGZvcm1DaGFubmVsTmFtZSI6IkxpdmUiLA0KCQZpc2xhdGlvbiI6IiINCn0=",
        "X-Riot-ClientVersion": clientVersion,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new RiotApiError("UNAUTHENTICATED", "Unauthorized");
      }
      if (response.status === 429) {
        throw new RiotApiError("RIOT_RATE_LIMITED", "Rate limited");
      }
      if (response.status >= 500) {
        throw new RiotApiError("RIOT_5XX", "Riot server error");
      }
      throw new RiotApiError("INTERNAL_ERROR", `HTTP ${String(response.status)}`);
    }

    return response.json();
  },

  async fetch(url: string, options: RequestInit): Promise<Response> {
    return fetch(url, options);
  },
};
