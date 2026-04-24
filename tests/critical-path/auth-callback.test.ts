import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { render } from "@testing-library/react";
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

describe("Feature: /login error query 렌더", () => {
  it("givenErrorQuery_whenRenderLogin_thenShowsLocalizedMessageAndRetry", async () => {
    // Given: searchParams { error: "mfa_required" }
    const searchParams = Promise.resolve({ error: "mfa_required" });

    // When: render <LoginPage />
    const LoginPage = (await import("@/app/(auth)/login/page")).default;
    const { container } = render(await LoginPage({ searchParams }));

    // Then: "2단계 인증이 필요합니다" 텍스트, "다시 시도" 버튼
    expect(container.textContent).toContain("2단계 인증이 필요합니다");
    expect(container.textContent).toContain("다시 시도");
  });

  it("givenInvalidCredentialsError_whenRenderLogin_thenShowsInvalidCredentialsMessage", async () => {
    const searchParams = Promise.resolve({ error: "invalid_credentials" });
    const LoginPage = (await import("@/app/(auth)/login/page")).default;
    const { container } = render(await LoginPage({ searchParams }));

    expect(container.textContent).toContain("로그인 정보가 올바르지 않습니다");
  });

  it("givenUnknownError_whenRenderLogin_thenShowsGenericMessage", async () => {
    const searchParams = Promise.resolve({ error: "unknown" });
    const LoginPage = (await import("@/app/(auth)/login/page")).default;
    const { container } = render(await LoginPage({ searchParams }));

    expect(container.textContent).toContain("로그인 중 오류가 발생했습니다");
  });

  it("givenNoError_whenRenderLogin_thenShowsNoErrorMessage", async () => {
    const searchParams = Promise.resolve({});
    const LoginPage = (await import("@/app/(auth)/login/page")).default;
    const { container } = render(await LoginPage({ searchParams }));

    // 에러 메시지 영역이 없어야 함
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
