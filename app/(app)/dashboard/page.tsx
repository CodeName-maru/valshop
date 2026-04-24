/**
 * 대시보드 페이지
 *
 * Phase 4: 클라이언트 측 에러 처리
 * - 401 시 자동 재로그인
 * - 429/5xx 시 에러 UI + 재시도 버튼
 * - ErrorBoundary로 crash 차단
 */

import { LogoutButton } from "@/components/LogoutButton";
import { Countdown } from "@/components/Countdown";
import DashboardClient from "./DashboardClient";

export default function DashboardPage() {
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
        <DashboardClient />
      </main>
    </div>
  );
}
