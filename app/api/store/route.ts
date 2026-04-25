/**
 * Store Proxy Route Handler
 * GET /api/store - 오늘의 상점 4개 스킨 반환
 */

import { NextResponse } from "next/server";
import { getTodayStore } from "@/lib/riot/storefront";
import { getSession } from "@/lib/session/guard";
import { RiotFetcher, RiotApiError } from "@/lib/riot/fetcher";

/**
 * 기본 RiotFetcher 구현체
 * 실제 재시도/에러 매핑 로직은 Plan 0006에서 구현
 */
class DefaultRiotFetcher implements RiotFetcher {
  async get(url: string, session: Awaited<ReturnType<typeof import("@/lib/session/guard").getSession>>, clientVersion: string): Promise<unknown> {
    if (!session) {
      throw new RiotApiError("UNAUTHENTICATED", "No session");
    }

    const response = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${session.accessToken}`,
        "X-Riot-Entitlements-JWT": session.entitlementsJwt,
        "X-Riot-ClientPlatform": "UE0xLZC0wMTc4NzYwNzYyODA0NzMyOWRjNTU0MTA3ZmJlMGM",
        "X-Riot-ClientVersion": clientVersion,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new RiotApiError("TOKEN_EXPIRED", "토큰이 만료되었습니다. 다시 로그인해 주세요.");
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
  }

  async fetch(url: string, options: RequestInit): Promise<Response> {
    return fetch(url, options);
  }
}

export const dynamic = "force-dynamic";

/**
 * GET /api/store
 * 오늘의 상점 4개 스킨을 반환
 */
export async function GET() {
  try {
    // 세션 확인
    const session = await getSession();

    if (!session) {
      return NextResponse.json(
        { code: "UNAUTHENTICATED", message: "No session" },
        { status: 401 }
      );
    }

    // 상점 조회
    const fetcher = new DefaultRiotFetcher();
    const store = await getTodayStore(session, { fetcher });

    return NextResponse.json(store);
  } catch (error) {
    if (error instanceof RiotApiError) {
      // Plan 0006 spec: 외부 응답 code 표준 (TOKEN_EXPIRED / RATE_LIMITED / SERVER_ERROR)
      // 내부 RiotErrorCode → 외부 응답 code 매핑
      const codeMap = {
        TOKEN_EXPIRED: { code: "TOKEN_EXPIRED", status: 401 },
        RIOT_RATE_LIMITED: { code: "RATE_LIMITED", status: 429 },
        RIOT_5XX: { code: "SERVER_ERROR", status: 502 },
        INTERNAL_ERROR: { code: "INTERNAL_ERROR", status: 500 },
        UNAUTHENTICATED: { code: "UNAUTHENTICATED", status: 401 },
      } as const;

      const mapped = codeMap[error.code];
      const messageMap: Record<string, string> = {
        TOKEN_EXPIRED: "토큰이 만료되었습니다. 다시 로그인해 주세요.",
        RATE_LIMITED: "요청이 많아 잠시 후 다시 시도해 주세요.",
        SERVER_ERROR: "Riot 서버에 일시적인 문제가 발생했습니다.",
        INTERNAL_ERROR: "내부 서버 오류가 발생했습니다.",
        UNAUTHENTICATED: "인증이 필요합니다.",
      };

      return NextResponse.json(
        { code: mapped.code, message: messageMap[mapped.code] ?? "오류가 발생했습니다." },
        { status: mapped.status }
      );
    }

    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}
