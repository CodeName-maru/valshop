/**
 * 대시보드 페이지 - Server Component (SSR)
 *
 * Plan 0025: async server component로 재작성
 * - 세션 검증 및 오늘의 상점 조회를 서버에서 수행
 * - 4개 스킨 카드를 SSR HTML에 포함
 * - 에러 분기: redirect 또는 StoreErrorState 렌더
 */

import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/LogoutButton";
import { Countdown } from "@/components/Countdown";
import { SkinCard } from "@/components/SkinCard";
import { StoreErrorState } from "@/components/StoreErrorState";
import { RetryButton } from "./RetryButton";
import { requireSession } from "@/lib/session/guard";
import { getTodayStore } from "@/lib/riot/storefront";
import { createRiotFetcher, RiotApiError } from "@/lib/riot/fetcher";

export default async function DashboardPage() {
  // UNAUTHENTICATED → /login redirect
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      redirect("/login");
    }
    throw error;
  }

  // Storefront 조회 및 에러 분기
  let store;
  try {
    store = await getTodayStore(session, { fetcher: createRiotFetcher() });
  } catch (error) {
    if (error instanceof RiotApiError) {
      // TOKEN_EXPIRED → /login?reason=expired redirect
      if (error.code === "TOKEN_EXPIRED") {
        redirect("/login?reason=expired");
      }
      // RIOT_5XX, RIOT_RATE_LIMITED, UPSTREAM_UNAVAILABLE → 에러 상태 + 재시도 버튼
      if (error.code === "RIOT_5XX" || error.code === "RIOT_RATE_LIMITED" || error.code === "UPSTREAM_UNAVAILABLE") {
        return (
          <div className="min-h-screen bg-slate-50">
            <header className="border-b bg-white">
              <div className="container mx-auto px-4 py-4 flex justify-between items-center">
                <h1 className="text-xl font-bold">Valshop</h1>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-xs text-slate-500">다음 상점 갱신까지</p>
                    <Countdown />
                  </div>
                  <LogoutButton />
                </div>
              </div>
            </header>
            <main className="container mx-auto px-4 py-8">
              <StoreErrorState />
            </main>
          </div>
        );
      }
    }
    // 그 외 에러는 그대로 throw (ErrorBoundary가 잡도록)
    throw error;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-xl font-bold">Valshop</h1>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-xs text-slate-500">다음 상점 갱신까지</p>
              <Countdown />
            </div>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {store.offers.map((skin) => (
            <SkinCard key={skin.uuid} skin={skin} />
          ))}
        </div>
      </main>
    </div>
  );
}
