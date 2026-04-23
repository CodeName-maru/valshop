import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GET } from "@/app/api/store/route";
import { NextRequest } from "next/server";

const server = setupServer();

beforeEach(() => {
  server.resetHandlers();
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.close();
});

describe("Feature: /api/store 에러 처리", () => {
  // 유효한 session 쿠키 값 (base64 인코딩된 JSON)
  const validSessionCookie = btoa(JSON.stringify({ userId: "test-user-123" }));

  it("given401FromStorefront_whenGetApiStore_thenReturns401WithTokenExpiredCode", async () => {
    // Given: MSW storefront 401, 유효한 암호화 cookie
    server.use(
      http.get("https://store.raider.io/api/v2/featured", () =>
        new HttpResponse(null, { status: 401 }),
      ),
    );

    // Mock request with cookies
    const url = new URL("http://localhost:3000/api/store");
    const request = {
      ...new Request(url, {
        method: "GET",
        headers: {
          Cookie: `session=${validSessionCookie}`,
        },
      }),
      nextUrl: url,
      url: url.href,
      headers: new Headers({
        Cookie: `session=${validSessionCookie}`,
      }),
    } as unknown as NextRequest;

    // When: GET /api/store
    const response = await GET(request);
    const body = await response.json();

    // Then: status 401, body { code: "TOKEN_EXPIRED", message: <한국어> }
    expect(response.status).toBe(401);
    expect(body.code).toBe("TOKEN_EXPIRED");
    expect(body.message).toBeTruthy();
    expect(typeof body.message).toBe("string");
  });

  it("given429Twice_whenGetApiStore_thenReturns429WithRateLimited", async () => {
    // Given: MSW 429 × 2
    server.use(
      http.get("https://store.raider.io/api/v2/featured", () =>
        new HttpResponse(null, { status: 429 }),
      ),
    );

    const url = new URL("http://localhost:3000/api/store");
    const request = {
      ...new Request(url, {
        method: "GET",
        headers: {
          Cookie: `session=${validSessionCookie}`,
        },
      }),
      nextUrl: url,
      url: url.href,
      headers: new Headers({
        Cookie: `session=${validSessionCookie}`,
      }),
    } as unknown as NextRequest;

    // When: GET /api/store
    const response = await GET(request);
    const body = await response.json();

    // Then: status 429, body.code === "RATE_LIMITED"
    expect(response.status).toBe(429);
    expect(body.code).toBe("RATE_LIMITED");
  });

  it("given503FromStorefront_whenGetApiStore_thenReturns502WithServerError", async () => {
    // Given: MSW 503
    server.use(
      http.get("https://store.raider.io/api/v2/featured", () =>
        new HttpResponse(null, { status: 503 }),
      ),
    );

    const url = new URL("http://localhost:3000/api/store");
    const request = {
      ...new Request(url, {
        method: "GET",
        headers: {
          Cookie: `session=${validSessionCookie}`,
        },
      }),
      nextUrl: url,
      url: url.href,
      headers: new Headers({
        Cookie: `session=${validSessionCookie}`,
      }),
    } as unknown as NextRequest;

    // When: GET /api/store
    const response = await GET(request);
    const body = await response.json();

    // Then: status 502, body.code === "SERVER_ERROR"
    expect(response.status).toBe(502);
    expect(body.code).toBe("SERVER_ERROR");
  });

  it("givenAnyError_whenGetApiStore_thenResponseBodyHasNoTokenOrCookie", async () => {
    // Given: 토큰 fixture 값 "SECRET_TOKEN_XYZ"
    const SECRET_TOKEN = "SECRET_TOKEN_XYZ";

    // Test 401
    server.use(
      http.get("https://store.raider.io/api/v2/featured", () =>
        new HttpResponse(null, {
          status: 401,
          headers: { "x-auth-token": SECRET_TOKEN },
        }),
      ),
    );

    const url = new URL("http://localhost:3000/api/store");
    const request = {
      ...new Request(url, {
        method: "GET",
        headers: {
          Cookie: `session=${validSessionCookie}`,
        },
      }),
      nextUrl: url,
      url: url.href,
      headers: new Headers({
        Cookie: `session=${validSessionCookie}`,
      }),
    } as unknown as NextRequest;

    // When: 에러 경로 (401) 호출
    const response = await GET(request);
    const body = await response.json();
    const bodyStr = JSON.stringify(body);

    // Then: JSON.stringify(body) 에 "SECRET_TOKEN_XYZ", "Bearer", "ssid" 미포함
    expect(bodyStr).not.toContain(SECRET_TOKEN);
    expect(bodyStr).not.toContain("Bearer");
    expect(bodyStr).not.toContain("ssid");
  });
});
