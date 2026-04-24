/**
 * 대시보드 페이지
 * 오늘의 상점 4개 스킨 카드를 SSR로 렌더링
 */

import { redirect } from "next/navigation";
import { SkinCard } from "@/components/SkinCard";
import { StoreErrorState } from "@/components/StoreErrorState";
import { getTodayStore } from "@/lib/riot/storefront";
import { requireSession } from "@/lib/session/guard";
import { RiotFetcher, RiotApiError } from "@/lib/riot/fetcher";

/**
 * 기본 RiotFetcher 구현체 (서버사이드)
 */
class ServerRiotFetcher implements RiotFetcher {
  async get(url: string, session: Awaited<ReturnType<typeof requireSession>>, clientVersion: string): Promise<unknown> {
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
}

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  try {
    // 세션 확인 (없으면 /login으로 리다이렉트)
    const session = await requireSession();
    const fetcher = new ServerRiotFetcher();

    // 상점 조회
    const store = await getTodayStore(session, { fetcher });

    return (
      <div className="min-h-screen bg-slate-50">
        <header className="border-b bg-white">
          <div className="container mx-auto px-4 py-4">
            <h1 className="text-xl font-bold">Valshop</h1>
          </div>
        </header>
        <main className="container mx-auto px-4 py-8">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {store.offers.map((skin: { uuid: string; name: string; priceVp: number; imageUrl: string; tierIconUrl: string | null }) => (
              <SkinCard key={skin.uuid} skin={skin} priority />
            ))}
          </div>
        </main>
      </div>
    );
  } catch (error) {
    // 토큰 만료 시 /login으로 리다이렉트
    if (error instanceof RiotApiError && error.code === "TOKEN_EXPIRED") {
      redirect("/login");
    }

    // 그 외 에러 시 에러 상태 표시
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="border-b bg-white">
          <div className="container mx-auto px-4 py-4">
            <h1 className="text-xl font-bold">Valshop</h1>
          </div>
        </header>
        <main className="container mx-auto px-4 py-8">
          <StoreErrorState />
        </main>
      </div>
    );
  }
}
