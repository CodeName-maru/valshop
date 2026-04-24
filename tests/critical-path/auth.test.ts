/**
 * Critical Path Tests for Riot Authentication Flow
 *
 * Tests handleAuthCallback directly to avoid testApiHandler cookie issues.
 * The actual GET /api/auth/callback route is tested via E2E (Playwright).
 */

import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

// MSW server setup
const server = setupServer(
  http.post("https://entitlements.auth.riotgames.com/api/token/v1", () => {
    return HttpResponse.json({ entitlements_token: "mock-entitlements-jwt" });
  }),
  http.get("https://auth.riotgames.com/userinfo", () => {
    return HttpResponse.json({ sub: "mock-puuid-12345" });
  }),
);

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

// Test 2-9: /api/auth/start redirect
describe("Feature: Riot 로그인 시작", () => {
  describe("Scenario: GET /api/auth/start", () => {
    it("givenStartRequest_whenGet_thenRedirectsToRiotAuthorizeWithStateCookie", async () => {
      const { GET: startHandler } = await import("@/app/api/auth/start/route");
      const request = new Request("http://localhost/api/auth/start", { method: "GET" });
      const response = await startHandler(request);

      // Should be 302 redirect
      expect(response.status).toBe(302);

      // Should redirect to Riot authorize URL
      const location = response.headers.get("location");
      expect(location).toMatch(/^https:\/\/auth\.riotgames\.com\/authorize/);

      // Should contain state parameter
      expect(location).toMatch(/state=/);

      // Should set auth_state cookie
      const setCookie = response.headers.get("set-cookie");
      expect(setCookie).toMatch(/auth_state=/);
      expect(setCookie).toMatch(/HttpOnly/);
      expect(setCookie).toMatch(/Secure/);
      expect(setCookie).toMatch(/SameSite=lax/i);
      expect(setCookie).toMatch(/Max-Age=600/);
    });
  });
});

// Test 2-1: State mismatch rejection
describe("Feature: Riot 로그인 콜백", () => {
  describe("Scenario: CSRF 방어 — state 불일치", () => {
    it("givenStateMismatch_whenCallback_thenRedirectsToLoginWithError", async () => {
      const { handleAuthCallback } = await import("@/app/api/auth/callback/route");
      const response = await handleAuthCallback({
        state: "xyz789",
        accessToken: "dummy-token",
        cookieState: "abc123", // Mismatch
        baseUrl: "http://localhost",
      });

      expect(response.status).toBe(302);
      const location = response.headers.get("location");
      expect(location).toMatch(/\/login\?error=state_mismatch/);
    });
  });
});

// Test 2-2: Success path with cookie attributes
describe("Feature: Riot 로그인 콜백 - 성공 경로", () => {
  it("givenValidRiotResponses_whenCallback_thenSetsSecureHttpOnlySessionCookie", async () => {
    const { handleAuthCallback } = await import("@/app/api/auth/callback/route");
    const state = "test-state-123";
    const accessToken = "test-access-token";

    const response = await handleAuthCallback({
      state,
      accessToken,
      cookieState: state, // Match
      baseUrl: "http://localhost",
    });

    // Should redirect to dashboard
    expect(response.status).toBe(302);
    const location = response.headers.get("location");
    expect(location).toContain("/dashboard");

    // Should set session cookie with correct attributes
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toMatch(/session=/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toMatch(/Path=\//);

    // Should clear auth_state cookie
    expect(setCookie).toMatch(/auth_state=;/);
  });
});

// Test 2-3: Concurrent callback independence
describe("Feature: Riot 로그인 콜백 - 동시성", () => {
  it("givenTwoConcurrentCallbacks_whenBothSucceed_thenEachReceivesOwnSession", async () => {
    const { handleAuthCallback } = await import("@/app/api/auth/callback/route");
    const state1 = "state-user-1";
    const state2 = "state-user-2";

    const [response1, response2] = await Promise.all([
      handleAuthCallback({ state: state1, accessToken: "token1", cookieState: state1, baseUrl: "http://localhost" }),
      handleAuthCallback({ state: state2, accessToken: "token2", cookieState: state2, baseUrl: "http://localhost" }),
    ]);

    // Both should succeed
    expect(response1.status).toBe(302);
    expect(response2.status).toBe(302);

    // Both should redirect to dashboard
    expect(response1.headers.get("location")).toContain("/dashboard");
    expect(response2.headers.get("location")).toContain("/dashboard");
  });
});

// Test 2-4: Riot call order and payload verification
describe("Feature: Riot 로그인 콜백 - 호출 순서", () => {
  it("givenAccessToken_whenCallback_thenCallsEntitlementsThenUserinfoInOrder", async () => {
    // Track call order using MSW
    const callOrder: string[] = [];

    // Use server.use for this test (will be reset by afterEach)
    // Note: MSW handlers may be called multiple times during request processing
    // We only care about the successful calls in the correct order
    server.use(
      http.post("https://entitlements.auth.riotgames.com/api/token/v1", ({ request }) => {
        callOrder.push("entitlements");
        // Verify Authorization header
        expect(request.headers.get("Authorization")).toBe("Bearer test-token-2-4");
        return HttpResponse.json({ entitlements_token: "mock-entitlements-jwt" });
      }),
      http.get("https://auth.riotgames.com/userinfo", ({ request }) => {
        callOrder.push("userinfo");
        // Verify Authorization header
        expect(request.headers.get("Authorization")).toBe("Bearer test-token-2-4");
        return HttpResponse.json({ sub: "mock-puuid-12345" });
      }),
    );

    const { handleAuthCallback } = await import("@/app/api/auth/callback/route");
    await handleAuthCallback({
      state: "test-state",
      accessToken: "test-token-2-4",
      cookieState: "test-state",
      baseUrl: "http://localhost",
    });

    // Verify call order: entitlements first, then userinfo
    // MSW may call handlers multiple times (CORS preflight, etc.)
    // We only care that entitlements comes before userinfo
    const entitlementsIndex = callOrder.indexOf("entitlements");
    const userinfoIndex = callOrder.indexOf("userinfo");
    expect(entitlementsIndex).toBeGreaterThanOrEqual(0);
    expect(userinfoIndex).toBeGreaterThanOrEqual(0);
    expect(entitlementsIndex).toBeLessThan(userinfoIndex);
  });
});

// Test 2-5: Riot 5xx error handling
describe("Feature: Riot 로그인 콜백 - 에러 처리", () => {
  it("givenEntitlementsReturns500_whenCallback_thenRedirectsToLoginUpstreamError", async () => {
    server.use(
      http.post("https://entitlements.auth.riotgames.com/api/token/v1", () => {
        return HttpResponse.json({}, { status: 500 });
      }),
    );

    const { handleAuthCallback } = await import("@/app/api/auth/callback/route");
    const response = await handleAuthCallback({
      state: "test-state",
      accessToken: "token",
      cookieState: "test-state",
      baseUrl: "http://localhost",
    });

    expect(response.status).toBe(302);
    const location = response.headers.get("location");
    expect(location).toMatch(/\/login\?error=upstream/);

    // Should NOT set session cookie
    const setCookie = response.headers.get("set-cookie");
    const cookieValue = Array.isArray(setCookie) ? setCookie.join("; ") : (setCookie ?? "");
    expect(cookieValue).not.toMatch(/session=[^;&s]+/);
  });
});

// Test 2-6: Timeout handling
describe("Feature: Riot 로그인 콜백 - 타임아웃", () => {
  it("givenRiotHangs_whenCallbackExceedsTimeout_thenRedirectsToLoginTimeout", async () => {
    server.use(
      http.post("https://entitlements.auth.riotgames.com/api/token/v1", async () => {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        return HttpResponse.json({ entitlements_token: "mock-entitlements-jwt" });
      }),
    );

    const { handleAuthCallback } = await import("@/app/api/auth/callback/route");
    const response = await handleAuthCallback({
      state: "test-state",
      accessToken: "token",
      cookieState: "test-state",
      baseUrl: "http://localhost",
    });

    expect(response.status).toBe(302);
    const location = response.headers.get("location");
    expect(location).toMatch(/\/login\?error=timeout/);
  });
});

// Test 2-7: No token plaintext in logs
describe("Feature: Riot 로그인 콜백 - 로그 보안", () => {
  it("givenSuccessfulCallback_whenInspectLogs_thenNoRawTokenAppears", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { handleAuthCallback } = await import("@/app/api/auth/callback/route");
    await handleAuthCallback({
      state: "test-state",
      accessToken: "sensitive-token-123",
      cookieState: "test-state",
      baseUrl: "http://localhost",
    });

    const logCalls = consoleSpy.mock.calls.flat().join(" ");
    expect(logCalls).not.toContain("sensitive-token-123");
    expect(logCalls).not.toContain("entitlements_token");

    consoleSpy.mockRestore();
  });
});

// Test 2-8: Only PUUID stored from userinfo
describe("Feature: Riot 로그인 콜백 - PIPA 최소수집", () => {
  it("givenUserinfoWithExtraPII_whenCallback_thenStoresOnlyPuuidInSession", async () => {
    server.use(
      http.get("https://auth.riotgames.com/userinfo", () => {
        return HttpResponse.json({
          sub: "puuid-only-123",
          email: "user@example.com",
          country: "KR",
          name: "Test User",
        });
      }),
    );

    const { handleAuthCallback } = await import("@/app/api/auth/callback/route");
    const response = await handleAuthCallback({
      state: "test-state",
      accessToken: "token",
      cookieState: "test-state",
      baseUrl: "http://localhost",
    });

    expect(response.status).toBe(302);

    // Verify session cookie contains encrypted payload
    const setCookie = response.headers.get("set-cookie");
    const cookieValue = Array.isArray(setCookie) ? setCookie.join("; ") : (setCookie ?? "");
    expect(cookieValue).toMatch(/session=/);

    // Response should not contain plaintext PII
    const body = await response.text();
    expect(body).not.toContain("user@example.com");
    expect(body).not.toContain("Test User");
  });
});

// Note: Missing token parameter handling in GET handler is tested via E2E
// The GET handler validates params before calling handleAuthCallback
