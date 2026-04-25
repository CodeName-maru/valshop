import { describe, it, expect } from "vitest";
import {
  toUserMessage,
  toLogPayload,
  RiotError,
  redactHeaders,
  maskPuuid,
} from "@/lib/riot/errors";

describe("Feature: toUserMessage sanitization", () => {
  it("givenErrorWithTokenInRawBody_whenToUserMessage_thenNoSecretLeaks", () => {
    // Given: RiotError 생성 시 upstream raw { access_token: "SECRET" }
    const err: RiotError = {
      code: "SERVER_ERROR",
      upstreamStatus: 500,
    } as RiotError;
    (err as unknown as { rawBody: string }).rawBody = JSON.stringify({
      access_token: "SECRET_TOKEN_XYZ",
    });

    // When: toUserMessage(err)
    const result = toUserMessage(err);

    // Then: 결과 문자열이 "SECRET" 미포함, "access_token" 미포함, "Bearer" 미포함
    expect(result).not.toContain("SECRET_TOKEN_XYZ");
    expect(result).not.toContain("access_token");
    expect(result).not.toContain("Bearer");
  });

  it("givenTokenExpired_whenToUserMessage_thenKoreanMessage", () => {
    const err: RiotError = {
      code: "TOKEN_EXPIRED",
      upstreamStatus: 401,
    };

    const result = toUserMessage(err);
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });
});

describe("Feature: toLogPayload redaction", () => {
  it("givenErrorWithAuthHeaders_whenToLogPayload_thenHeadersRedacted", () => {
    // Given: err.context = { headers: { Authorization: "Bearer X", Cookie: "ssid=Y" } }
    const err: RiotError = {
      code: "SERVER_ERROR",
      upstreamStatus: 500,
    } as RiotError;
    (err as unknown as { context: { headers: Record<string, string> } }).context = {
      headers: {
        Authorization: "Bearer SECRET_TOKEN",
        Cookie: "ssid=SECRET_SSID",
        "X-Safe": "keep-this",
      },
    };

    // When: JSON.stringify(toLogPayload(err))
    const result = JSON.stringify(toLogPayload(err));

    // Then: "Bearer SECRET_TOKEN" 미포함, "ssid=SECRET_SSID" 미포함, 대신 "[REDACTED]" 존재
    expect(result).not.toContain("Bearer SECRET_TOKEN");
    expect(result).not.toContain("ssid=SECRET_SSID");
    expect(result).toContain("[REDACTED]");
  });

  it("givenAnyRiotError_whenToLogPayload_thenHasStableSchema", () => {
    // Given: RiotError 전 케이스
    const errors: RiotError[] = [
      { code: "TOKEN_EXPIRED", upstreamStatus: 401 },
      { code: "RATE_LIMITED", retryAfterMs: 1000, upstreamStatus: 429 },
      { code: "SERVER_ERROR", upstreamStatus: 503 },
      { code: "AUTH_FAILED", reason: "mfa_required", upstreamStatus: 401 },
      { code: "CLIENT_VERSION_MISMATCH", upstreamStatus: 400 },
    ];

    for (const err of errors) {
      // When: toLogPayload(err)
      const payload = toLogPayload(err);

      // Then: payload.keys() === ["code","upstreamStatus","ts","reason?"]
      //       Vercel 로그 필터 쿼리 (`code:"RATE_LIMITED"`) 가능
      expect(payload).toHaveProperty("code");
      expect(payload).toHaveProperty("upstreamStatus");
      expect(payload).toHaveProperty("ts");
      expect(typeof payload.code).toBe("string");
      expect(typeof payload.upstreamStatus).toBe("number");
      expect(typeof payload.ts).toBe("string");
    }
  });

  it("givenArbitraryContext_whenToLogPayload_thenOnlyWhitelistedFieldsIncluded", () => {
    // Given: err.context 에 임의 필드 { puuid, access_token, refresh_token, foo }
    const err: RiotError = {
      code: "SERVER_ERROR",
      upstreamStatus: 500,
    } as RiotError;
    (err as unknown as { context: Record<string, unknown> }).context = {
      puuid: "12345678-1234-1234-1234-123456789abc",
      access_token: "SECRET_ACCESS",
      refresh_token: "SECRET_REFRESH",
      foo: "bar",
      safeField: "keep",
    };

    // When: toLogPayload
    const payload = toLogPayload(err);

    // Then: access_token/refresh_token 미포함. puuid 는 뒷 4자리만 `***abcd` 형태.
    const result = JSON.stringify(payload);
    expect(result).not.toContain("SECRET_ACCESS");
    expect(result).not.toContain("SECRET_REFRESH");
    expect(result).toContain("***9abc"); // puuid masked
    expect(result).toContain("keep"); // safeField 보존
  });
});

describe("Feature: redactHeaders helper", () => {
  it("givenAuthorizationHeader_whenRedactHeaders_thenRedacted", () => {
    const headers = {
      authorization: "Bearer TOKEN",
      "x-custom-header": "value",
    };

    const result = redactHeaders(headers);
    expect(result.authorization).toBe("[REDACTED]");
    expect(result["x-custom-header"]).toBe("value");
  });

  it("givenCookieHeader_whenRedactHeaders_thenRedacted", () => {
    const headers = {
      cookie: "ssid=value",
      "x-safe": "keep",
    };

    const result = redactHeaders(headers);
    expect(result.cookie).toBe("[REDACTED]");
    expect(result["x-safe"]).toBe("keep");
  });
});

describe("Feature: maskPuuid helper", () => {
  it("givenValidPuuid_whenMaskPuuid_thenLastFourDigitsOnly", () => {
    const puuid = "12345678-1234-1234-1234-123456789abc";
    const result = maskPuuid(puuid);
    expect(result).toBe("***9abc");
  });

  it("givenShortPuuid_whenMaskPuuid_thenMasked", () => {
    const puuid = "abc";
    const result = maskPuuid(puuid);
    expect(result).toBe("***abc");
  });

  it("givenEmptyPuuid_whenMaskPuuid_thenEmpty", () => {
    const result = maskPuuid("");
    expect(result).toBe("");
  });
});
