import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GET } from "@/app/api/auth/callback/route";
import { NextRequest } from "next/server";

const server = setupServer();

beforeEach(() => {
  server.resetHandlers();
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.close();
});

describe("Feature: /api/auth/callback 로그인 실패 리다이렉트", () => {
  it("given2FAFromRiot_whenCallback_thenRedirectsLoginMfa", async () => {
    // Given: MSW auth → multifactor 응답
    server.use(
      http.post("https://auth.raider.io/token", () =>
        HttpResponse.json({ type: "multifactor" }, { status: 401 }),
      ),
    );

    // NextRequest 생성
    const url = new URL("http://localhost:3000/api/auth/callback?code=test-code");
    const request = {
      ...new Request(url),
      nextUrl: url,
      url: url.href,
    } as unknown as NextRequest;

    // When: GET /api/auth/callback
    const response = await GET(request);

    // Then: 302 Location: /login?error=mfa_required
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/login?error=mfa_required");
  });

  it("givenAuthFailureFromRiot_whenCallback_thenRedirectsLoginInvalid", async () => {
    // Given: MSW auth → auth_failure
    server.use(
      http.post("https://auth.raider.io/token", () =>
        HttpResponse.json({ error: "auth_failure" }, { status: 401 }),
      ),
    );

    const url = new URL("http://localhost:3000/api/auth/callback?code=test-code");
    const request = {
      ...new Request(url),
      nextUrl: url,
      url: url.href,
    } as unknown as NextRequest;

    // When: GET /api/auth/callback
    const response = await GET(request);

    // Then: 302 /login?error=invalid_credentials
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain(
      "/login?error=invalid_credentials",
    );
  });

  it("givenUnclassifiedError_whenCallback_thenRedirectsLoginUnknown", async () => {
    // Given: 분류 실패 (알 수 없는 응답)
    server.use(
      http.post("https://auth.raider.io/token", () =>
        HttpResponse.json({ unknown: "error" }, { status: 500 }),
      ),
    );

    const url = new URL("http://localhost:3000/api/auth/callback?code=test-code");
    const request = {
      ...new Request(url),
      nextUrl: url,
      url: url.href,
    } as unknown as NextRequest;

    // When: GET /api/auth/callback
    const response = await GET(request);

    // Then: Location: /login?error=unknown (raw 메시지 노출 금지)
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/login?error=unknown");
  });

  it("givenCatastrophicExceptionInCallback_whenCalled_thenReturnsRedirectNotCrash", async () => {
    // Given: exchange 함수가 예상 밖 throw
    server.use(
      http.post("https://auth.raider.io/token", () => {
        throw new Error("Network catastrophe");
      }),
    );

    const url = new URL("http://localhost:3000/api/auth/callback?code=test-code");
    const request = {
      ...new Request(url),
      nextUrl: url,
      url: url.href,
    } as unknown as NextRequest;

    // When: GET /api/auth/callback
    const response = await GET(request);

    // Then: 302 /login?error=unknown (500 이 아닌 graceful fallback)
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/login?error=unknown");
  });
});
