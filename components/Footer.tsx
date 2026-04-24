import Link from "next/link";

/**
 * 법적 고지 푸터 컴포넌트
 *
 * PRD § 7 Compliance NFR: 모든 페이지에 "fan-made" 고지 필수
 */
export function Footer() {
  return (
    <footer
      role="contentinfo"
      className="mt-auto border-t border-border/40 bg-background/95 py-6 text-xs text-muted-foreground backdrop-blur supports-[backdrop-filter]:bg-background/60"
    >
      <div className="container mx-auto px-4">
        <p className="text-center">
          VAL-Shop 은 라이엇 게임즈와 무관한 팬메이드 프로젝트입니다
        </p>
        <div className="mt-2 flex justify-center gap-4">
          <Link
            href="/privacy"
            className="hover:text-foreground transition-colors"
          >
            개인정보 처리방침
          </Link>
          <a
            href="https://github.com/maru/valshop"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}
