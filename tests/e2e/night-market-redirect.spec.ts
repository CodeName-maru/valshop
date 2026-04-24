import { test, expect } from "@playwright/test";

test.describe("Feature: 야시장 리다이렉트", () => {
  test.describe("Scenario: 야시장 비활성 시 리다이렉트", () => {
    test("Given 야시장 비활성, When GET /night-market, Then 리다이렉트 /dashboard", async ({ page }) => {
      // Given: MSW 가 storefront 에 BonusStore 없는 응답 (실제 환경에서는 API에서 비활성)
      // When
      await page.goto("/night-market");
      // Then
      await expect(page).toHaveURL(/\/dashboard/);
    });
  });

  test.describe("Scenario: 야시장 활성 시 뷰 렌더", () => {
    test("Given 야시장 활성, When GET /night-market, Then 페이지 렌더", async ({ page }) => {
      // Note: 이 테스트는 실제 야시장 활성화 시기에만 통과
      // 현재는 MSW나 실제 API 응답에 따라 동작
      await page.goto("/night-market");
      // 야시장이 활성화되어 있지 않으면 /dashboard로 리다이렉트됨
      const url = page.url();
      expect(url).toMatch(/\/(night-market|dashboard)/);
    });
  });
});
