/**
 * CSP Integration Tests (Phase 2)
 * Tests: 2-1, 2-3 from plan 0024
 *
 * Note: Test 2-2 (E2E with Playwright) is in tests/e2e/
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createNext, FileRef } from "next-test-api-route-handler";
import fetch from "node-fetch";

describe("CSP Headers (Tests 2-1, 2-3)", () => {
  let app: Awaited<ReturnType<typeof createNext>>;
  let port: number;

  beforeAll(async () => {
    app = await createNext({
      files: new FileRef(process.cwd()),
      installDeps: false,
    });
    port = (app as { port: number }).port;
  });

  afterAll(async () => {
    await app?.destroy();
  });

  describe("Test 2-1: CSP header presence", () => {
    it("should have CSP header on any page", async () => {
      const response = await fetch(`http://localhost:${port}/login`);
      const csp = response.headers.get("Content-Security-Policy");

      expect(csp).toBeTruthy();
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("img-src 'self' https://media.valorant-api.com data:");
      expect(csp).toContain("style-src 'self' 'unsafe-inline'");
      expect(csp).toContain("connect-src 'self'");
    });
  });

  describe("Test 2-3: valorant-api images allowed", () => {
    it("should allow media.valorant-api.com in img-src", async () => {
      const response = await fetch(`http://localhost:${port}/login`);
      const csp = response.headers.get("Content-Security-Policy");

      expect(csp).toContain("https://media.valorant-api.com");
    });
  });
});
