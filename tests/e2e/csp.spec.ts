/**
 * CSP E2E Tests (Phase 2-2)
 * Test: 2-2 from plan 0024
 *
 * Verifies that CSP violations are 0 on login page
 */

import { test, expect } from "@playwright/test";

test.describe("CSP E2E (Test 2-2)", () => {
  test("given_login_page_load_when_playwright_visit_then_no_csp_violation", async ({ page }) => {
    // Collect console messages
    const consoleErrors: string[] = [];
    const cspViolations: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // Listen for CSP violation reports
    page.on("response", async (response) => {
      const headers = response.headers();
      const csp = headers["content-security-policy"];
      if (csp) {
        console.log("CSP header present:", csp);
      }
    });

    // Navigate to login page
    await page.goto("/login");

    // Wait for page to be fully loaded
    await page.waitForLoadState("networkidle");
    await page.waitForSelector("a[href='/api/auth/start']");

    // Check that no CSP-related console errors occurred
    const cspRelatedErrors = consoleErrors.filter((error) =>
      error.toLowerCase().includes("content security policy") ||
      error.toLowerCase().includes("csp") ||
      error.toLowerCase().includes("refused to execute") ||
      error.toLowerCase().includes("refused to connect") ||
      error.toLowerCase().includes("refused to load")
    );

    expect(
      cspRelatedErrors.length,
      `CSP violations found: ${cspRelatedErrors.join(", ")}`
    ).toBe(0);

    // Verify CSP header is present
    const response = await page.goto("/login");
    const cspHeader = response?.headers()["content-security-policy"];
    expect(cspHeader).toBeTruthy();
    expect(cspHeader).toContain("default-src 'self'");
    expect(cspHeader).toContain("img-src");
    expect(cspHeader).toContain("style-src");
    expect(cspHeader).toContain("connect-src");
  });

  test("given_valorant_api_image_when_store_page_then_allowed", async ({ page }) => {
    // Navigate to a page that might load external images
    // For now, test that img-src allows media.valorant-api.com
    const response = await page.goto("/login");
    const cspHeader = response?.headers()["content-security-policy"];

    expect(cspHeader).toContain("https://media.valorant-api.com");
    expect(cspHeader).toContain("data:");
  });
});
