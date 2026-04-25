import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Plan 0006: /api/store 외부 응답 contract 검증
// - 401 → status 401, code TOKEN_EXPIRED
// - 429 → status 429, code RATE_LIMITED
// - 5xx → status 502, code SERVER_ERROR

// session guard mock: 유효 세션 항상 반환
vi.mock("@/lib/session/guard", () => ({
  getSession: vi.fn(() =>
    Promise.resolve({
      puuid: "test-puuid",
      accessToken: "SECRET_TOKEN_XYZ",
      entitlementsJwt: "test-jwt",
      expiresAt: Date.now() + 3_600_000,
      region: "kr",
    }),
  ),
  requireSession: vi.fn(() =>
    Promise.resolve({
      puuid: "test-puuid",
      accessToken: "SECRET_TOKEN_XYZ",
      entitlementsJwt: "test-jwt",
      expiresAt: Date.now() + 3_600_000,
      region: "kr",
    }),
  ),
}));

// catalog / version mock: storefront 호출 전 의존성을 가볍게
vi.mock("@/lib/riot/version", () => ({
  getClientVersion: vi.fn(() => Promise.resolve("release-08.11-shipping-6-3154137")),
}));

vi.mock("@/lib/valorant-api/catalog", () => ({
  getSkinCatalog: vi.fn(() => Promise.resolve(new Map())),
  getTierCatalog: vi.fn(() => Promise.resolve(new Map())),
}));

import { GET } from "@/app/api/store/route";

// global fetch 를 mocking 하여 storefront 응답을 시뮬레이션
const originalFetch = global.fetch;
const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("Feature: /api/store 에러 처리", () => {
  it("given401FromStorefront_whenGetApiStore_thenReturns401WithTokenExpiredCode", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as unknown as Response);

    const response = await GET();
    const body = (await response.json()) as { code: string; message: string };

    expect(response.status).toBe(401);
    expect(body.code).toBe("TOKEN_EXPIRED");
    expect(body.message).toBeTruthy();
    expect(typeof body.message).toBe("string");
  });

  it("given429Twice_whenGetApiStore_thenReturns429WithRateLimited", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({}),
    } as unknown as Response);

    const response = await GET();
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(429);
    expect(body.code).toBe("RATE_LIMITED");
  });

  it("given503FromStorefront_whenGetApiStore_thenReturns502WithServerError", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as unknown as Response);

    const response = await GET();
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(502);
    expect(body.code).toBe("SERVER_ERROR");
  });

  it("givenAnyError_whenGetApiStore_thenResponseBodyHasNoTokenOrCookie", async () => {
    const SECRET_TOKEN = "SECRET_TOKEN_XYZ";

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: new Headers({ "x-auth-token": SECRET_TOKEN }),
      json: async () => ({}),
    } as unknown as Response);

    const response = await GET();
    const body = (await response.json()) as Record<string, unknown>;
    const bodyStr = JSON.stringify(body);

    expect(bodyStr).not.toContain(SECRET_TOKEN);
    expect(bodyStr).not.toContain("Bearer");
    expect(bodyStr).not.toContain("ssid");
  });
});
