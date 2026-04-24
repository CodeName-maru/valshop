import { test, expect } from "@playwright/test";

test.describe("Feature: 2-step login with MFA", () => {
  test("credential → mfa → dashboard happy path", async ({ page }) => {
    // MSW 핸들러는 이미 setup되어 있다고 가정 (Plan 0020)
    // 필요한 경우 여기서 추가 핸들러 등록

    await page.goto("/login");

    // NoticeBanner 확인 (ADR-0011)
    await expect(page.getByTestId("notice-banner")).toContainText(
      "공식 서비스가 아닙니다"
    );

    // Credential step
    await page.getByLabel(/라이엇 아이디|아이디/).fill("player#KR1");
    await page.getByLabel(/비밀번호/).fill("pw1234");
    await page.getByRole("button", { name: /로그인/ }).click();

    // MFA step - email_hint 확인
    // Note: 실제 API 응답에 따라 email_hint가 표시됨
    // MSW에서 mfa_required 응답을 stub 해야 함
    await expect(page.getByLabel(/인증 코드/)).toBeVisible();
    await expect(page.getByText(/@\w+\.\w+/)).toBeVisible(); // email 형식

    // MFA 코드 입력
    await page.getByLabel(/인증 코드/).fill("123456");
    await page.getByRole("button", { name: /^인증$/ }).click();

    // 성공 시 루트(/)로 라우팅
    await page.waitForURL("/");
    // Dashboard 엘리먼트 확인 (data-testid="dashboard-root" 또는 대체)
    const dashboardElement = page.getByTestId("dashboard-root");
    if ((await dashboardElement.count()) > 0) {
      await expect(dashboardElement).toBeVisible();
    } else {
      // 대체 selector (대시보드 페이지의 특정 엘리먼트)
      await expect(page.locator("h1")).toContainText(/VAL-Shop|Dashboard/);
    }
  });
});
