import { render, screen } from "@testing-library/react";
import { Footer } from "../../components/Footer";

describe("Feature: 법적 고지 푸터", () => {
  describe("Scenario: 모든 페이지 공통 푸터", () => {
    it("Given 렌더, When 조회, Then 'VAL-Shop 은 라이엇 게임즈와 무관한 팬메이드 프로젝트' 포함", () => {
      // Given/When
      render(<Footer />);
      // Then
      expect(
        screen.getByText(/VAL-Shop 은 라이엇 게임즈와 무관한 팬메이드 프로젝트/)
      ).toBeInTheDocument();
    });

    it("Given 렌더, When role=contentinfo 쿼리, Then landmark 존재 (접근성)", () => {
      render(<Footer />);
      expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    });
  });
});
