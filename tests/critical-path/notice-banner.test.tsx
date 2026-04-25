import { render, screen } from "@testing-library/react";
import NoticeBanner from "@/app/(app)/login/notice-banner";

describe("NoticeBanner", () => {
  it("givenNoticeBanner_whenRendered_thenContainsAllRequiredPhrases", () => {
    render(<NoticeBanner />);

    // ADR-0011 키워드 3종
    expect(
      screen.getByText(/공식.*아닙니다|공식 서비스가 아닙니다/)
    ).toBeInTheDocument();
    expect(screen.getByText(/본인 계정 시연/)).toBeInTheDocument();
    expect(screen.getByText(/2FA.*권장|2단계 인증.*권장/)).toBeInTheDocument();
  });
});
