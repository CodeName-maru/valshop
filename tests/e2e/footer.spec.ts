import { test, expect } from "@playwright/test";

test.describe("Feature: 법적 고지 푸터 E2E", () => {
  test.describe("Scenario: 모든 페이지에서 푸터 노출", () => {
    const paths = ["/", "/login", "/dashboard", "/privacy"];

    for (const path of paths) {
      test(`Given ${path}, When 방문, Then 푸터 문구 노출`, async ({ page }) => {
        await page.goto(path);
        await expect(page.getByText(/팬메이드 프로젝트/)).toBeVisible();
      });
    }
  });
});
