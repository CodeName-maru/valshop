/**
 * normalizeRiotError unit tests
 * Phase 3: lib/riot/errors.ts 확장
 */

import { describe, it, expect } from "vitest";
import {
  normalizeRiotError,
  type AuthErrorCode,
  type NormalizedRiotError,
} from "@/lib/riot/errors";

describe("normalizeRiotError", () => {
  describe("Test 3-1~3-4: table-driven Riot 응답 → AuthErrorCode", () => {
    it.each([
      [{ error: "auth_failure" }, 200, "invalid_credentials"],
      [{ error: "rate_limited" }, 429, "rate_limited"],
      [{ type: "multifactor_attempt_failed" }, 200, "mfa_invalid"],
      [{ error: "auth_failure" }, 401, "session_expired"], // ssid reauth 맥락
      [{}, 500, "riot_unavailable"],
      [{}, 503, "riot_unavailable"],
      ["<html>cloudflare 1020</html>", 403, "rate_limited"],
      [null, 0, "unknown"], // timeout/AbortError → caller 가 {status:0} 로 전달
    ])("givenRawResponse_whenNormalize_thenMapsToExpectedAuthErrorCode", (body, status, expected) => {
      // Given: raw = {body, status, phase?: "credential"|"mfa"|"reauth"}
      const raw = { body, status };

      // When: normalizeRiotError(raw)
      const result = normalizeRiotError(raw);

      // Then: result.code === expected
      expect(result.code).toBe(expected);
    });
  });

  describe("Test 3-5: raw body 에서 민감 필드 redact 후 로그 페이로드 구성", () => {
    it("givenBodyWithSensitiveFields_whenNormalize_thenLogPayloadRedactsTokens", () => {
      // Given: body = {access_token:"leak", id_token:"leak2", ssid:"leak3", password:"leak4", authentication_code:"leak5", nested:{ssid:"leak6"}, normal_field:"ok"}
      const body = {
        access_token: "leak",
        id_token: "leak2",
        ssid: "leak3",
        password: "leak4",
        authentication_code: "leak5",
        nested: { ssid: "leak6" },
        normal_field: "ok",
      };

      // When: const {code, logPayload} = normalizeRiotError({body, status:200});
      const result = normalizeRiotError({ body, status: 200 });

      // Then:
      //   - logPayload 에 "leak"/"leak2".."leak6" 문자열 부재 (문자열화해서 검사)
      const logPayloadStr = JSON.stringify(result.logPayload);
      expect(logPayloadStr).not.toContain("leak");
      expect(logPayloadStr).not.toContain("leak2");
      expect(logPayloadStr).not.toContain("leak3");
      expect(logPayloadStr).not.toContain("leak4");
      expect(logPayloadStr).not.toContain("leak5");
      expect(logPayloadStr).not.toContain("leak6");

      //   - normal_field은 보존
      const logPayloadBody = result.logPayload.body as Record<string, unknown>;
      expect(logPayloadBody.normal_field).toBe("ok");

      //   - redactKey 들이 "[REDACTED]" 로 치환
      expect(logPayloadBody.access_token).toBe("[REDACTED]");
      expect(logPayloadBody.id_token).toBe("[REDACTED]");
      expect(logPayloadBody.ssid).toBe("[REDACTED]");
      expect(logPayloadBody.password).toBe("[REDACTED]");
      expect(logPayloadBody.authentication_code).toBe("[REDACTED]");
      expect((logPayloadBody.nested as Record<string, unknown>).ssid).toBe("[REDACTED]");
    });
  });

  describe("Test 3-6: Set-Cookie 응답 헤더는 redact", () => {
    it("givenResponseWithSetCookie_whenNormalize_thenLogPayloadOmitsCookieValues", () => {
      // Given: raw = {response: Response with Set-Cookie: ssid=leak}
      const mockResponse = new Response(
        JSON.stringify({ error: "auth_failure" }),
        {
          headers: {
            "set-cookie": "ssid=leak; Domain=auth.riotgames.com",
          },
        },
      );

      // When / Then: logPayload.headers["set-cookie"] === "[REDACTED]"
      const result = normalizeRiotError({
        body: { error: "auth_failure" },
        status: 200,
        response: mockResponse,
      });

      // 로그 페이로드에서 set-cookie가 redact되었는지 확인
      const logPayload = result.logPayload as { headers?: Record<string, unknown> };
      expect(logPayload.headers?.["set-cookie"]).toBe("[REDACTED]");
    });
  });

  describe("Test 3-7: phase 힌트가 분기 해결에 쓰임", () => {
    it("givenAuthFailureInReauthPhase_whenNormalize_thenMapsSessionExpired", () => {
      // Given: {body:{error:"auth_failure"}, status:200, phase:"reauth"}
      const raw = {
        body: { error: "auth_failure" },
        status: 200,
        phase: "reauth" as const,
      };

      // When / Then: code === "session_expired"
      const result = normalizeRiotError(raw);
      expect(result.code).toBe("session_expired");
    });

    it("givenAuthFailureInCredentialPhase_whenNormalize_thenMapsInvalidCredentials", () => {
      // Given: phase:"credential" → "invalid_credentials"
      const raw = {
        body: { error: "auth_failure" },
        status: 200,
        phase: "credential" as const,
      };

      // When / Then
      const result = normalizeRiotError(raw);
      expect(result.code).toBe("invalid_credentials");
    });
  });

  describe("Test 3-8: Cloudflare 1020 감지", () => {
    it("givenCloudflare1020Response_whenNormalize_thenMapsToRateLimited", () => {
      // Given: Cloudflare 1020 응답
      const raw = {
        body: "<html>cloudflare 1020 error</html>",
        status: 403,
      };

      // When / Then
      const result = normalizeRiotError(raw);
      expect(result.code).toBe("rate_limited");
    });
  });

  describe("Test 3-9: 다양한 Riot 에러 응답", () => {
    it("givenMultifactorResponse_whenNormalize_thenMapsToMfaRequired", () => {
      // Given: MFA 필요 응답
      const raw = {
        body: { type: "multifactor", multifactor: { email: "j***@example.com" } },
        status: 200,
      };

      // When / Then
      const result = normalizeRiotError(raw);
      expect(result.code).toBe("mfa_required");
    });
  });

  describe("Test 3-10: 로그 페이로드에 민감필드 부재 검증", () => {
    it("givenSensitiveDataInLogPayload_whenFormat_thenDoesNotLeak", () => {
      // Given: 다양한 민감 데이터 포함 응답
      const body = {
        access_token: "at123",
        id_token: "it456",
        refresh_token: "rt789",
        entitlements_token: "et101",
        password: "pw123",
        authentication_code: "123456",
        nested: { ssid: "ssid-abc" },
        safe_field: "safe-value",
      };

      // When
      const result = normalizeRiotError({ body, status: 200 });
      const logPayloadStr = JSON.stringify(result.logPayload);

      // Then: 모든 민감 값이 redact
      expect(logPayloadStr).not.toContain("at123");
      expect(logPayloadStr).not.toContain("it456");
      expect(logPayloadStr).not.toContain("rt789");
      expect(logPayloadStr).not.toContain("et101");
      expect(logPayloadStr).not.toContain("pw123");
      expect(logPayloadStr).not.toContain("123456");
      expect(logPayloadStr).not.toContain("ssid-abc");
      expect(logPayloadStr).toContain("safe-value");
    });
  });
});
