import { Metadata } from "next";

export const metadata: Metadata = {
  title: "로그인",
  description: "VAL-Shop 로그인",
};

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center">
            <h1 className="text-3xl font-bold">VAL-Shop</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              라이엇 게임즈 계정으로 로그인하세요
            </p>
          </div>

          <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
            <p className="mb-4 text-center text-sm text-muted-foreground">
              로그인 기능은 현재 준비 중입니다.
            </p>
            <div className="text-center text-xs text-muted-foreground">
              VAL-Shop은 라이엇 게임즈와 무관한 팬메이드 프로젝트입니다.
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
