/**
 * Plan 0021 Phase 2: MFA Route Tests
 *
 * spec § 4-3: FR-R4
 * NFR: Performance (p95 ≤ 2s), Security (위조 검증), Operability (구조화 로그)
 *
 * Plan 0021 follow-up (PR #20 fix B2):
 * - placeholder asserts → 실제 POST() 호출 + 응답 검증
 * - jar 복원 검증: PUT /authorization 호출 시 ssid Cookie 헤더 포함 확인
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "../../../vitest.setup";

// ----- Mocks ---------------------------------------------------------------

const createSessionMock = vi.fn(async () => ({
  sessionId: "00000000-1111-2222-3333-444444444444",
  maxAge: 1209600,
}));

vi.mock("@/lib/session/store", () => ({
  getSessionStore: () => ({
    createSession: createSessionMock,
    destroy: vi.fn(),
    resolve: vi.fn(),
  }),
}));

vi.mock("@/lib/middleware/rate-limit", () => ({
  withRateLimit: vi.fn(async () => null),
  extractIp: () => "1.2.3.4",
}));

vi.mock("@/lib/session/crypto", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/session/crypto")>();
  return {
    ...actual,
    extractPuuidFromIdToken: (idToken: string) => {
      if (idToken && idToken.includes("mfa-id-token")) {
        return "mfa-puuid-12345";
      }
      return actual.extractPuuidFromIdToken(idToken);
    },
  };
});

// Import AFTER mocks
import { POST } from "@/app/api/auth/mfa/route";
import { NextRequest } from "next/server";
import { encodePendingJar } from "@/lib/session/pending-jar";

const APP_ORIGIN = "https://valshop.vercel.app";

async function makePending(jarCookies = [{ name: "ssid", value: "ssid-restored-value" }]) {
  return await encodePendingJar(jarCookies, "tester");
}

function makeReq(opts: {
  body: unknown;
  pending?: string | null;
  origin?: string | null;
}): NextRequest {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-forwarded-for": "1.2.3.4",
  };
  const origin = opts.origin === undefined ? APP_ORIGIN : opts.origin;
  if (origin) headers["Origin"] = origin;

  if (opts.pending) {
    headers["Cookie"] = `auth_pending=${opts.pending}`;
  }

  return new NextRequest("https://valshop.vercel.app/api/auth/mfa", {
    method: "POST",
    headers,
    body: JSON.stringify(opts.body),
  });
}

describe("POST /api/auth/mfa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_ORIGIN = APP_ORIGIN;
    process.env.TOKEN_ENC_KEY = Buffer.alloc(32, "a").toString("base64");
    process.env.PENDING_ENC_KEY = Buffer.alloc(32, "b").toString("base64");
    process.env.AUTH_MODE = "credentials";

    // crypto 캐시 초기화 (다른 테스트 영향 회피)
    // require() 패턴 회피용 동적 import
  });

  afterEach(() => {
    delete process.env.APP_ORIGIN;
    delete process.env.AUTH_MODE;
  });

  describe("Scenario: MFA happy path", () => {
    it("Given 유효 auth_pending + 올바른 코드, When POST, Then 200 + session cookie + jar 복원 확인", async () => {
      // jar 복원 검증을 위해 PUT 핸들러에서 Cookie 헤더 캡처
      let capturedCookieHeader: string | null = null;

      mswServer.use(
        http.put("https://auth.riotgames.com/api/v1/authorization", ({ request }) => {
          capturedCookieHeader = request.headers.get("cookie");
          return HttpResponse.json({
            type: "response",
            response: {
              parameters: {
                uri: "https://playvalorant.com/opt_in#access_token=mfa-access-token&id_token=mfa-id-token",
              },
            },
          });
        }),
        http.post("https://entitlements.auth.riotgames.com/api/token/v1", () => {
          return HttpResponse.json({
            entitlements_token: "mfa-entitlements-jwt",
          });
        }),
      );

      const pending = await makePending([
        { name: "ssid", value: "ssid-restored-value" },
        { name: "tdid", value: "tdid-restored-value" },
      ]);
      const req = makeReq({ body: { code: "123456" }, pending });
      const res = await POST(req);

      expect(res.status).toBe(200);
      const setCookie = res.headers.get("set-cookie") || "";
      expect(setCookie).toContain("session=");
      // auth_pending cleared
      expect(setCookie).toMatch(/auth_pending=;/);

      expect(createSessionMock).toHaveBeenCalledOnce();

      // 핵심: jar 가 실제로 채워져서 PUT 요청에 ssid Cookie 가 포함됐는지
      expect(capturedCookieHeader).not.toBeNull();
      expect(capturedCookieHeader || "").toContain("ssid=ssid-restored-value");
    });
  });

  describe("Scenario: invalid MFA code", () => {
    it("Given 잘못된 코드, When POST, Then 401 mfa_invalid", async () => {
      mswServer.use(
        http.put("https://auth.riotgames.com/api/v1/authorization", () => {
          return HttpResponse.json({
            type: "multifactor_attempt_failed",
          });
        }),
      );

      const pending = await makePending();
      const req = makeReq({ body: { code: "000000" }, pending });
      const res = await POST(req);

      expect(res.status).toBe(401);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("mfa_invalid");
    });
  });

  describe("Scenario: missing auth_pending cookie", () => {
    it("Given pending 없음, When POST, Then 400 mfa_expired", async () => {
      const req = makeReq({ body: { code: "123456" } });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("mfa_expired");
    });
  });

  describe("Scenario: forged / tampered auth_pending", () => {
    it("Given 위조 pending, When POST, Then 400 mfa_expired", async () => {
      const req = makeReq({
        body: { code: "123456" },
        pending: "tampered-blob-not-valid-base64-gcm",
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("mfa_expired");
    });
  });
});
