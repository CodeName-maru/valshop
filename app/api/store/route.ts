/**
 * Store Proxy Route Handler
 * GET /api/store - 오늘의 상점 4개 스킨 반환
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getTodayStore } from "@/lib/riot/storefront";
import { getSession } from "@/lib/session/guard";
import { RiotFetcher, RiotApiError, type RiotErrorCode } from "@/lib/riot/fetcher";

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
        throw new RiotApiError("TOKEN_EXPIRED", "Token expired");
      }
      if (response.status === 429) {
        throw new RiotApiError("RIOT_RATE_LIMITED", "Rate limited");
      }
      if (response.status >= 500) {
        throw new RiotApiError("RIOT_5XX", "Riot server error");
      }
      throw new RiotApiError("INTERNAL_ERROR", `HTTP ${response.status}`);
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
      const statusMap: Record<RiotErrorCode, number> = {
        TOKEN_EXPIRED: 401,
        RIOT_RATE_LIMITED: 502,
        RIOT_5XX: 502,
        INTERNAL_ERROR: 500,
        UNAUTHENTICATED: 401,
      };

      return NextResponse.json(
        { code: error.code, message: error.message },
        { status: statusMap[error.code] || 500 }
      );
    }

    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}
