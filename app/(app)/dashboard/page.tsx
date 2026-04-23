/**
 * 대시보드 페이지
 * MVP에서는 간단한 레이아웃과 로그아웃 버튼만 포함
 */

import { LogoutButton } from "@/components/LogoutButton";

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-xl font-bold">Valshop</h1>
          <LogoutButton />
        </div>
      </header>
      <main className="container mx-auto px-4 py-8">
        <p>대시보드 내용</p>
      </main>
    </div>
  );
}
