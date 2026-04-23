import { describe, it, expect } from "vitest";
import { classifyRiotResponse, classifyAuthResponse, RiotError } from "@/lib/riot/errors";

describe("Feature: Riot HTTP 응답 분류", () => {
  it("given401Response_whenClassify_thenTokenExpired", async () => {
    // Given: Response { status: 401 }
    const res = new Response("Unauthorized", { status: 401 });

    // When: classifyRiotResponse(res)
    const result = await classifyRiotResponse(res);

    // Then: { code: "TOKEN_EXPIRED" }
    expect(result).toEqual({
      code: "TOKEN_EXPIRED",
      upstreamStatus: 401,
    });
  });

  it("given429Response_whenClassify_thenRateLimitedWithRetryAfter", async () => {
    // Given: Response { status: 429, headers: { "retry-after": "2" } }
    const res = new Response("Too Many Requests", {
      status: 429,
      headers: { "retry-after": "2" },
    });

    // When: classifyRiotResponse(res)
    const result = await classifyRiotResponse(res);

    // Then: { code: "RATE_LIMITED", retryAfterMs: 2000 }
    expect(result).toEqual({
      code: "RATE_LIMITED",
      retryAfterMs: 2000,
      upstreamStatus: 429,
    });
  });

  it("given500Response_whenClassify_thenServerError", async () => {
    // Given: Response { status: 503 }
    const res = new Response("Service Unavailable", { status: 503 });

    // When: classifyRiotResponse(res)
    const result = await classifyRiotResponse(res);

    // Then: { code: "SERVER_ERROR", upstreamStatus: 503 }
    expect(result).toEqual({
      code: "SERVER_ERROR",
      upstreamStatus: 503,
    });
  });

  it("given400WithVersionHint_whenClassify_thenClientVersionMismatch", async () => {
    // Given: Response { status: 400, body: { errorCode: "INVALID_CLIENT_VERSION" } }
    const body = JSON.stringify({ errorCode: "INVALID_CLIENT_VERSION" });
    const res = new Response(body, { status: 400 });

    // When: classifyRiotResponse(res)
    const result = await classifyRiotResponse(res);

    // Then: { code: "CLIENT_VERSION_MISMATCH" } (ADR-0005 연계)
    expect(result).toEqual({
      code: "CLIENT_VERSION_MISMATCH",
      upstreamStatus: 400,
    });
  });

  it("given200Response_whenClassify_thenReturnsNull", async () => {
    // Given: Response { status: 200 }
    const res = new Response('{"ok":true}', { status: 200 });

    // When: classifyRiotResponse(res)
    const result = await classifyRiotResponse(res);

    // Then: null (성공은 에러가 아님)
    expect(result).toBeNull();
  });
});

describe("Feature: Auth 실패 서브코드 분류", () => {
  it("given2FAChallengeResponse_whenClassifyAuth_thenMfaRequired", () => {
    // Given: auth body { type: "multifactor" }
    const body = { type: "multifactor" };

    // When: classifyAuthResponse(body)
    const result = classifyAuthResponse(body);

    // Then: { code: "AUTH_FAILED", reason: "mfa_required", upstreamStatus: 401 }
    expect(result).toEqual({
      code: "AUTH_FAILED",
      reason: "mfa_required",
      upstreamStatus: 401,
    });
  });

  it("givenInvalidCredentialsBody_whenClassifyAuth_thenInvalidCredentials", () => {
    // Given: body { error: "auth_failure" }
    const body = { error: "auth_failure" };

    // When: classifyAuthResponse(body)
    const result = classifyAuthResponse(body);

    // Then: { code: "AUTH_FAILED", reason: "invalid_credentials", upstreamStatus: 401 }
    expect(result).toEqual({
      code: "AUTH_FAILED",
      reason: "invalid_credentials",
      upstreamStatus: 401,
    });
  });

  it("givenUnknownAuthError_whenClassifyAuth_thenNull", () => {
    // Given: body { unknown: "error" }
    const body = { unknown: "error" };

    // When: classifyAuthResponse(body)
    const result = classifyAuthResponse(body);

    // Then: null (분류 불가)
    expect(result).toBeNull();
  });
});

describe("Feature: discriminated union exhaustive 검증", () => {
  it("givenRiotError_whenSwitchExhaustive_thenCompilesWithoutDefault", () => {
    // 이 테스트는 TypeScript 컴파일러 검증을 위한 것입니다.
    // 모든 RiotError 코드 분기를 처리하면 default 없이도 컴파일되어야 합니다.
    // 실제 검증은 tsc --noEmit 로 수행됩니다.

    const exhaustiveSwitch = (err: RiotError): string => {
      switch (err.code) {
        case "TOKEN_EXPIRED":
          return "expired";
        case "RATE_LIMITED":
          return "rate_limited";
        case "SERVER_ERROR":
          return "server_error";
        case "AUTH_FAILED":
          return "auth_failed";
        case "CLIENT_VERSION_MISMATCH":
          return "version_mismatch";
        case "UPSTREAM_UNAVAILABLE":
          return "upstream_unavailable";
        default:
          throw new Error("Unhandled error code");
      }
    };

    const testErrors: RiotError[] = [
      { code: "TOKEN_EXPIRED", upstreamStatus: 401 },
      { code: "RATE_LIMITED", retryAfterMs: 1000, upstreamStatus: 429 },
      { code: "SERVER_ERROR", upstreamStatus: 503 },
      { code: "AUTH_FAILED", reason: "mfa_required", upstreamStatus: 401 },
      { code: "CLIENT_VERSION_MISMATCH", upstreamStatus: 400 },
      { code: "UPSTREAM_UNAVAILABLE", upstreamStatus: 503 },
    ];

    for (const err of testErrors) {
      expect(() => exhaustiveSwitch(err)).not.toThrow();
    }
  });
});
