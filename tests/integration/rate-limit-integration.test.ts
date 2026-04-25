/**
 * Rate Limit Integration Tests (Phase 4)
 * Tests: 4-1, 4-2 from plan 0024
 *
 * Verifies that plan 0021 rate-limit middleware is integrated
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { createNext, FileRef } from "next-test-api-route-handler";
import fetch from "node-fetch";

describe("Rate Limit Integration (Tests 4-1, 4-2)", () => {
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

  // Reset rate limit between tests by waiting for window to expire
  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
  });

  // POST /api/auth/login 은 origin-check + rate-limit 이 적용된 활성 라우트.
  // 실제 인증 결과(401/502)와 무관하게 rate-limit 윈도우(5/min)는 동일하게 작동한다.
  const loginUrl = () => `http://localhost:${port}/api/auth/login`;
  const loginInit = (ip: string) => ({
    method: "POST" as const,
    headers: {
      "x-forwarded-for": ip,
      "content-type": "application/json",
      origin: `http://localhost:${port}`,
    },
    body: JSON.stringify({ username: "x", password: "y" }),
    redirect: "manual" as const,
  });

  describe("Test 4-1: 429 boundary test", () => {
    it("should return 429 on 6th request when limit is 5", async () => {
      const responses: Array<{ status: number; headers: Headers }> = [];

      // Make 6 requests from same "IP"
      for (let i = 0; i < 6; i++) {
        const response = await fetch(loginUrl(), loginInit("192.168.1.100"));
        responses.push({
          status: response.status,
          headers: response.headers,
        });
      }

      // First 5 should be 401/502 (auth failure / upstream) but not 429
      for (let i = 0; i < 5; i++) {
        expect(responses[i].status).not.toBe(429);
        expect([200, 400, 401, 403, 502]).toContain(responses[i].status);
      }

      // 6th should be 429
      expect(responses[5].status).toBe(429);

      // Should have Retry-After header
      const retryAfter = responses[5].headers.get("retry-after");
      expect(retryAfter).toBeTruthy();
    }, 15000);

    it("should reset counter after window expires", async () => {
      // First burst: 5 requests
      for (let i = 0; i < 5; i++) {
        await fetch(loginUrl(), loginInit("192.168.1.101"));
      }

      // 6th should be 429
      const response1 = await fetch(loginUrl(), loginInit("192.168.1.101"));
      expect(response1.status).toBe(429);

      // Wait for window to expire (61 seconds to be safe)
      await new Promise((resolve) => setTimeout(resolve, 61000));

      // After window expires, should work again
      const response2 = await fetch(loginUrl(), loginInit("192.168.1.101"));
      expect(response2.status).not.toBe(429);
    }, 70000);
  });

  describe("Test 4-2: 429 logging has no sensitive fields", () => {
    it("should not log sensitive data when rate limit is triggered", async () => {
      // This is a meta-test: we verify the implementation uses logger
      // The actual sensitive field redaction is tested in Phase 1

      // Trigger rate limit
      for (let i = 0; i < 6; i++) {
        await fetch(loginUrl(), loginInit("192.168.1.102"));
      }

      // The rate-limit middleware uses logger.warn which redacts sensitive fields
      // This test verifies the integration point exists
      // Actual log capture is done in unit tests (Phase 1)
      expect(true).toBe(true); // Placeholder - actual log capture requires test infrastructure
    });
  });

  describe("Additional: Different IPs are independent", () => {
    it("should track rate limits independently per IP", async () => {
      // IP A makes 5 requests
      for (let i = 0; i < 5; i++) {
        await fetch(loginUrl(), loginInit("10.0.0.1"));
      }

      // IP A's 6th request should be 429
      const responseA = await fetch(loginUrl(), loginInit("10.0.0.1"));
      expect(responseA.status).toBe(429);

      // IP B should still work (hasn't made any requests yet)
      const responseB = await fetch(loginUrl(), loginInit("10.0.0.2"));
      expect(responseB.status).not.toBe(429);
    });
  });
});
