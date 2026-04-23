import { Metadata } from "next";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "개인정보 처리방침",
  description: "VAL-Shop 개인정보 처리방침",
};

export default function PrivacyPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="mb-6 text-3xl font-bold">개인정보 처리방침</h1>

      <div className="prose prose-neutral max-w-none dark:prose-invert">
        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">1. 수집하는 개인정보</h2>
          <p className="mb-2">
            VAL-Shop은 라이엇 게임즈 계정 연동을 위해 최소한의 개인정보만을 수집합니다.
          </p>
          <ul className="list-disc pl-6">
            <li>로그인을 위한 인증 토큰 (쿠키에 저장, 브라우저 내에만 보관)</li>
            <li>상점 조회를 위한 PUUID (Riot ID 기반 생성, 서버에 저장하지 않음)</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">2. 개인정보의 처리 목적</h2>
          <p className="mb-2">
            수집한 개인정보는 다음 목적으로만 사용됩니다.
          </p>
          <ul className="list-disc pl-6">
            <li>사용자 인증 및 세션 유지</li>
            <li>라이엇 게임즈 상점 API 호출</li>
            <li>스킨 가격 정보 표시</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">3. 개인정보의 보관 및 파기</h2>
          <p className="mb-2">
            인증 토큰은 쿠키로만 저장되며, 로그아웃 시 즉시 삭제됩니다.
            서버에는 사용자의 개인정보를 저장하지 않습니다.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">4. 제3자 제공</h2>
          <p className="mb-2">
            VAL-Shop은 사용자의 개인정보를 제3자에게 제공하지 않습니다.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">5. 쿠키의 사용</h2>
          <p className="mb-2">
            본 서비스는 로그인 상태 유지를 위해 쿠키를 사용합니다.
            브라우저 설정을 통해 쿠키를 거부할 수 있으나, 이 경우 서비스 이용이 제한될 수 있습니다.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">6. 문의처</h2>
          <p className="mb-2">
            개인정보 처리방침과 관련된 문의사항은 GitHub 이슈를 통해 접수해 주시기 바랍니다.
          </p>
          <a
            href="https://github.com/maru/valshop/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            GitHub 이슈 트래커
          </a>
        </section>

        <section className="mt-8 rounded-lg bg-muted p-4">
          <p className="text-sm text-muted-foreground">
            본 처리방침은 2026년 4월 24일부터 시행됩니다.
          </p>
        </section>
      </div>

      <Footer />
    </div>
  );
}
