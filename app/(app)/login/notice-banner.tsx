/**
 * 고지 배너 - ADR-0011
 *
 * VAL-Shop은 라이엇 게임즈 공식 서비스가 아님을 명시합니다.
 * 본인 계정 시연용이며 2FA 사용을 권장합니다.
 */
export default function NoticeBanner() {
  return (
    <aside
      data-testid="notice-banner"
      className="sticky top-0 z-40 border-b border-border bg-card/95 px-4 py-2 text-xs text-muted-foreground backdrop-blur"
    >
      <div className="mx-auto max-w-md text-center">
        <p className="font-medium">
          VAL-Shop은 라이엇 게임즈 공식 서비스가 아닙니다.
        </p>
        <p className="mt-0.5 text-[10px] opacity-80">
          본인 계정 시연용 · 2FA 사용을 권장합니다
        </p>
      </div>
    </aside>
  );
}
