import { test, expect } from "@playwright/test";

test.describe("Feature: 공개 배포 접근", () => {
  test("Given *.vercel.app URL, When GET /, Then 200 과 HTML 수신", async ({ request }) => {
    // Given: 배포 URL (env DEPLOY_URL)
    const url = process.env.DEPLOY_URL ?? "http://localhost:3000";
    // When
    const res = await request.get(url);
    // Then
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain("<html");
  });

  test("Given 배포 URL, When GET /dashboard, Then 200 과 렌더", async ({ request }) => {
    const url = process.env.DEPLOY_URL ?? "http://localhost:3000";
    const res = await request.get(`${url}/dashboard`);
    expect(res.status()).toBe(200);
  });
});
