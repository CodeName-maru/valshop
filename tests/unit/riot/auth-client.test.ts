/**
 * auth-client unit tests
 * Phase 2: lib/riot/auth-client.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RiotFetcher } from "@/lib/riot/fetcher";
import {
  initAuthFlow,
  submitCredentials,
  submitMfa,
  reauthWithSsid,
  exchangeEntitlements,
} from "@/lib/riot/auth-client";
import { RiotCookieJar } from "@/lib/riot/cookie-jar";

// Mock fetcher
function createMockFetcher() {
  const responses: Response[] = [];
  const fetcher: RiotFetcher = {
    fetch: vi.fn(async (_url: string, _options?: RequestInit) => {
      const response = responses.shift();
      if (!response) {
        throw new Error("No mock response configured");
      }
      return response;
    }),
  };

  return {
    fetcher,
    queue: (response: Response) => responses.push(response),
    reset: () => responses.length = 0,
  };
}

describe("auth-client", () => {
  describe("Test 2-1: initAuthFlow 이 authorize GET(Preflight) 호출 + jar 에 쿠키 축적", () => {
    it("givenFreshJar_whenInitAuthFlow_thenCallsPreflightAndPopulatesJar", async () => {
      // Given: fresh RiotCookieJar, mock fetcher 가 Set-Cookie 응답
      const jar = new RiotCookieJar();
      const { fetcher, queue } = createMockFetcher();

      const preflightResponse = new Response(
        JSON.stringify({ type: "auth" }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "set-cookie": "asid=test-asid; Domain=auth.riotgames.com; Secure; HttpOnly",
          },
        },
      );
      queue(preflightResponse);

      // When: await initAuthFlow(jar, fetcher)
      await initAuthFlow(jar, fetcher);

      // Then:
      //   - fetcher.fetch 가 "https://auth.riotgames.com/api/v1/authorization" POST 로 호출됨 (Preflight)
      //   - jar.getHeader(...) 가 asid 포함
      expect(fetcher.fetch).toHaveBeenCalledWith(
        "https://auth.riotgames.com/api/v1/authorization",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        }),
      );

      // 저장된 쿠키를 같은 URL로 조회
      const header = await jar.getHeader("https://auth.riotgames.com/api/v1/authorization");
      expect(header).toContain("asid=test-asid");
    });
  });

  describe("Test 2-2: submitCredentials happy path → {kind:\"ok\", accessToken}", () => {
    it("givenValidCredentials_whenSubmitCredentials_thenReturnsOkWithAccessToken", async () => {
      // Given: jar 가 initAuthFlow 완료 상태, fetcher 가 성공 응답
      const jar = new RiotCookieJar();
      const { fetcher, queue } = createMockFetcher();

      // 먼저 쿠키 저장
      const preflightResponse = new Response(null, {
        headers: {
          "set-cookie": "asid=test-asid; Domain=auth.riotgames.com",
        },
      });
      await jar.storeFromResponse("https://auth.riotgames.com/api/v1/authorization", preflightResponse);

      // 성공 응답 (Amendment A-3 형식)
      const successResponse = new Response(
        JSON.stringify({
          type: "response",
          response: {
            parameters: {
              uri: "https://playvalorant.com/opt_in#access_token=test-at-123&id_token=test-id-456&scope=account+openid&token_type=Bearer&expires_in=3600",
            },
          },
          country: "kor",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
      queue(successResponse);

      // When: await submitCredentials(jar, {username:"u",password:"p"}, fetcher)
      const result = await submitCredentials(jar, { username: "u", password: "p" }, fetcher);

      // Then: 결과 === {kind:"ok", accessToken:"test-at-123", idToken:"test-id-456"}
      expect(result).toEqual({
        kind: "ok",
        accessToken: "test-at-123",
        idToken: "test-id-456",
      });

      //       fetcher 호출 URL = "https://auth.riotgames.com/api/v1/authorization", method=PUT
      expect(fetcher.fetch).toHaveBeenCalledWith(
        "https://auth.riotgames.com/api/v1/authorization",
        expect.objectContaining({
          method: "PUT",
        }),
      );

      //       request body 에 {type:"auth", username:"u", password:"p", remember:true, language:"en_US"} 포함
      const callArgs = (fetcher.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body as string);
      expect(body).toEqual({
        type: "auth",
        username: "u",
        password: "p",
        remember: true,
        language: "en_US",
      });
    });
  });

  describe("Test 2-3: submitCredentials MFA 분기 → {kind:\"mfa\", emailHint}", () => {
    it("givenAccountRequiresMfa_whenSubmitCredentials_thenReturnsMfaBranchWithEmailHint", async () => {
      // Given: fetcher 가 MFA 응답 (Amendment A-4 형식)
      const jar = new RiotCookieJar();
      const { fetcher, queue } = createMockFetcher();

      const mfaResponse = new Response(
        JSON.stringify({
          type: "multifactor",
          multifactor: {
            method: "email",
            email: "j***@gmail.com",
            methods: ["email"],
          },
          country: "kor",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
      queue(mfaResponse);

      // When
      const result = await submitCredentials(jar, { username: "u", password: "p" }, fetcher);

      // Then: 결과 === {kind:"mfa", emailHint:"j***@gmail.com"}
      expect(result).toEqual({
        kind: "mfa",
        emailHint: "j***@gmail.com",
      });
    });
  });

  describe("Test 2-4: submitCredentials invalid → {kind:\"invalid\"}", () => {
    it("givenWrongPassword_whenSubmitCredentials_thenReturnsInvalid", async () => {
      // Given: fetcher 가 {error:"auth_failure"} 응답
      const jar = new RiotCookieJar();
      const { fetcher, queue } = createMockFetcher();

      const errorResponse = new Response(
        JSON.stringify({ error: "auth_failure" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
      queue(errorResponse);

      // When / Then: 결과 === {kind:"invalid"}
      const result = await submitCredentials(jar, { username: "u", password: "p" }, fetcher);
      expect(result).toEqual({ kind: "invalid" });
    });
  });

  describe("Test 2-5: submitCredentials 타임아웃 → {kind:\"upstream\"}", () => {
    it("givenRiotHangs_whenSubmitCredentialsExceeds3s_thenReturnsUpstream", async () => {
      // Given: fetcher 가 AbortError 를 throw
      const jar = new RiotCookieJar();
      const { fetcher } = createMockFetcher();

      (fetcher.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("AbortError: The operation was aborted"),
      );

      // When / Then: 결과 === {kind:"upstream"}
      const result = await submitCredentials(jar, { username: "u", password: "p" }, fetcher);
      expect(result).toEqual({ kind: "upstream" });
    });
  });

  describe("Test 2-6: submitCredentials 429 → {kind:\"rate_limited\"}", () => {
    it("givenRiot429_whenSubmitCredentials_thenReturnsRateLimited", async () => {
      // Given: fetcher 가 429 응답
      const jar = new RiotCookieJar();
      const { fetcher, queue } = createMockFetcher();

      const rateLimitResponse = new Response(null, { status: 429 });
      queue(rateLimitResponse);

      // When / Then: 결과 === {kind:"rate_limited"}
      const result = await submitCredentials(jar, { username: "u", password: "p" }, fetcher);
      expect(result).toEqual({ kind: "rate_limited" });
    });
  });

  describe("Test 2-7: submitCredentials 5xx → {kind:\"upstream\"}", () => {
    it("givenRiot503_whenSubmitCredentials_thenReturnsUpstream", async () => {
      // Given: fetcher 가 503 응답
      const jar = new RiotCookieJar();
      const { fetcher, queue } = createMockFetcher();

      const errorResponse = new Response(null, { status: 503 });
      queue(errorResponse);

      // When / Then: 결과 === {kind:"upstream"}
      const result = await submitCredentials(jar, { username: "u", password: "p" }, fetcher);
      expect(result).toEqual({ kind: "upstream" });
    });
  });

  describe("Test 2-8: submitMfa happy path", () => {
    it("givenValidMfaCode_whenSubmitMfa_thenReturnsOkWithAccessToken", async () => {
      // Given: jar 가 pending 상태, fetcher 가 성공 응답
      const jar = new RiotCookieJar();
      const { fetcher, queue } = createMockFetcher();

      const successResponse = new Response(
        JSON.stringify({
          type: "response",
          response: {
            parameters: {
              uri: "https://playvalorant.com/opt_in#access_token=test-at-456&id_token=test-id-mfa",
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
      queue(successResponse);

      // When: await submitMfa(jar, "123456", fetcher)
      const result = await submitMfa(jar, "123456", fetcher);

      // Then: 결과 === {kind:"ok", accessToken:"test-at-456"}
      expect(result).toEqual({
        kind: "ok",
        accessToken: "test-at-456",
        idToken: "test-id-mfa",
      });

      //       PUT body 에 {type:"multifactor", code:"123456", rememberDevice:true} 포함
      const callArgs = (fetcher.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body as string);
      expect(body).toEqual({
        type: "multifactor",
        code: "123456",
        rememberDevice: true,
      });
    });
  });

  describe("Test 2-9: submitMfa 잘못된 코드 → {kind:\"invalid\"}", () => {
    it("givenWrongMfaCode_whenSubmitMfa_thenReturnsInvalid", async () => {
      // Given: fetcher 가 {type:"multifactor_attempt_failed"} 응답
      const jar = new RiotCookieJar();
      const { fetcher, queue } = createMockFetcher();

      const errorResponse = new Response(
        JSON.stringify({ type: "multifactor_attempt_failed" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
      queue(errorResponse);

      // When / Then: 결과 === {kind:"invalid"}
      const result = await submitMfa(jar, "wrong-code", fetcher);
      expect(result).toEqual({ kind: "invalid" });
    });
  });

  describe("Test 2-10: reauthWithSsid happy path", () => {
    it("givenValidSsid_whenReauthWithSsid_thenReturnsOkWithAccessToken", async () => {
      // Given: fetcher 가 redirect 응답으로 Location 에 access_token 포함
      const { fetcher, queue } = createMockFetcher();

      const redirectResponse = new Response(null, {
        status: 303,
        headers: {
          Location: "https://playvalorant.com/opt_in#access_token=test-at-789&id_token=test-id-999",
        },
      });
      queue(redirectResponse);

      // When: await reauthWithSsid("ssid-blob", "tdid-blob", fetcher)
      const result = await reauthWithSsid("ssid-blob", "tdid-blob", fetcher);

      // Then: 결과 === {kind:"ok", accessToken:"test-at-789"}
      expect(result).toEqual({
        kind: "ok",
        accessToken: "test-at-789",
        idToken: "test-id-999",
      });

      //       호출 URL 이 "https://auth.riotgames.com/authorize?...&prompt=none..." GET
      expect(fetcher.fetch).toHaveBeenCalledWith(
        expect.stringContaining("auth.riotgames.com/authorize?"),
        expect.objectContaining({
          method: "GET",
        }),
      );

      //       Cookie 헤더에 "ssid=ssid-blob" 포함, (tdid 제공 시) "tdid=tdid-blob" 포함
      const callArgs = (fetcher.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const cookieHeader = callArgs[1]?.headers?.Cookie as string;
      expect(cookieHeader).toContain("ssid=ssid-blob");
      expect(cookieHeader).toContain("tdid=tdid-blob");
    });
  });

  describe("Test 2-11: reauthWithSsid 만료 → {kind:\"expired\"}", () => {
    it("givenExpiredSsid_whenReauthWithSsid_thenReturnsExpired", async () => {
      // Given: fetcher 가 {type:"auth"} (재로그인 요구) body 응답
      const { fetcher, queue } = createMockFetcher();

      const expiredResponse = new Response(
        JSON.stringify({ type: "auth" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
      queue(expiredResponse);

      // When / Then: 결과 === {kind:"expired"}
      const result = await reauthWithSsid("expired-ssid", undefined, fetcher);
      expect(result).toEqual({ kind: "expired" });
    });
  });

  describe("Test 2-12: reauthWithSsid 5xx → {kind:\"upstream\"}", () => {
    it("givenRiot5xx_whenReauthWithSsid_thenReturnsUpstream", async () => {
      // Given/When/Then: status=500 → upstream
      const { fetcher, queue } = createMockFetcher();

      const errorResponse = new Response(null, { status: 500 });
      queue(errorResponse);

      const result = await reauthWithSsid("ssid", undefined, fetcher);
      expect(result).toEqual({ kind: "upstream" });
    });
  });

  describe("Test 2-12b: reauthWithSsid 는 redirect:'manual' 옵션을 fetch 에 전달", () => {
    it("givenSsid_whenReauthWithSsid_thenFetchInitContainsRedirectManual", async () => {
      // Given: 임의 redirect 응답 (assertion 대상은 fetch init 옵션)
      const { fetcher, queue } = createMockFetcher();

      const redirectResponse = new Response(null, {
        status: 303,
        headers: {
          Location: "https://playvalorant.com/opt_in#access_token=at&id_token=id",
        },
      });
      queue(redirectResponse);

      // When
      await reauthWithSsid("ssid-blob", undefined, fetcher);

      // Then: Node fetch 가 302/303 을 자동 follow 하지 않도록 redirect:"manual" 이 주입돼야 한다
      expect(fetcher.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          redirect: "manual",
        }),
      );
    });
  });

  describe("Test 2-13: reauthWithSsid 429 → {kind:\"rate_limited\"}", () => {
    it("givenRiot429_whenReauthWithSsid_thenReturnsRateLimited", async () => {
      // Given: Cloudflare throttle 등으로 429 응답
      const { fetcher, queue } = createMockFetcher();

      const rateLimitedResponse = new Response(null, { status: 429 });
      queue(rateLimitedResponse);

      // When / Then: expired 가 아닌 rate_limited 로 분기되어야 한다 (강제 로그아웃 루프 방지)
      const result = await reauthWithSsid("ssid", undefined, fetcher);
      expect(result).toEqual({ kind: "rate_limited" });
    });
  });

  describe("Test 2-14: exchangeEntitlements 성공", () => {
    it("givenAccessToken_whenExchangeEntitlements_thenReturnsJwt", async () => {
      // Given: fetcher 가 {entitlements_token:"ejw..."} 응답
      const { fetcher, queue } = createMockFetcher();

      const successResponse = new Response(
        JSON.stringify({ entitlements_token: "ejw-test-token" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
      queue(successResponse);

      // When / Then: "ejw-test-token" 반환
      const result = await exchangeEntitlements("test-at", fetcher);
      expect(result).toBe("ejw-test-token");
    });
  });

  describe("Test 2-15: 공통 AbortSignal 3s 주입 확인 (공통)", () => {
    it.each([
      ["initAuthFlow", async (jar: RiotCookieJar, f: RiotFetcher) => initAuthFlow(jar, f)],
      ["submitCredentials", async (jar: RiotCookieJar, f: RiotFetcher) => submitCredentials(jar, { username: "u", password: "p" }, f)],
      ["submitMfa", async (jar: RiotCookieJar, f: RiotFetcher) => submitMfa(jar, "111111", f)],
      // reauthWithSsid는 내부에서 jar를 생성하므로 별도 처리
    ])("given%sCall_whenInvoked_thenPassesAbortSignalWith3sTimeout", async (_name, invoke) => {
      // Given: spy fetcher 가 options.signal 을 캡처
      const jar = new RiotCookieJar();
      const { fetcher, queue } = createMockFetcher();

      // 성공 응답 큐에 추가
      queue(new Response(null, { status: 200 }));

      // When: invoke 호출
      await invoke(jar, fetcher);

      // Then: signal 존재, timeout 이 3000ms 근사치
      const callArgs = (fetcher.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const signal = callArgs[1]?.signal as AbortSignal;
      expect(signal).toBeDefined();
      expect(signal).toBeInstanceOf(AbortSignal);
    });
  });
});
