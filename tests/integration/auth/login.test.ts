/**
 * Plan 0021 Phase 1: Login Route Tests
 *
 * spec § 4-5: FR-R4
 * NFR: Performance (p95 ≤ 3s), Security (PW 누수 방지), Operability (구조화 로그)
 *
 * Plan 0021 follow-up (PR #20 fix B2/B3):
 * - placeholder asserts → 실제 POST() 호출 + 응답 검증
 * - SessionStore + logger 는 vi.mock 으로 주입
 * - PW 누수 smoke: logger / response body 어디에도 sentinel 미포함 확인
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "../../../vitest.setup";

// ----- Mocks ---------------------------------------------------------------

// SessionStore: DB 의존 회피 — in-memory fake
const createSessionMock = vi.fn(async () => ({
  sessionId: "00000000-1111-2222-3333-444444444444",
  maxAge: 1209600,
}));
const destroySessionMock = vi.fn(async () => {});
const resolveSessionMock = vi.fn(async () => null);

vi.mock("@/lib/session/store", () => ({
  getSessionStore: () => ({
    createSession: createSessionMock,
    destroy: destroySessionMock,
    resolve: resolveSessionMock,
  }),
}));

// Rate limit: 통과 (개별 테스트에서 override 가능)
const withRateLimitMock = vi.fn(async () => null);
vi.mock("@/lib/middleware/rate-limit", () => ({
  withRateLimit: (...args: unknown[]) => withRateLimitMock(...args),
  extractIp: () => "1.2.3.4",
}));

// JWT decode: idToken="mock-id-token" → {sub: "test-puuid"}
vi.mock("@/lib/session/crypto", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/session/crypto")>();
  return {
    ...actual,
    extractPuuidFromIdToken: (idToken: string) => {
      if (idToken && idToken.includes("mock-id-token")) {
        return "test-puuid-12345";
      }
      return actual.extractPuuidFromIdToken(idToken);
    },
  };
});

// Logger spy
const loggerInfo = vi.fn();
const loggerWarn = vi.fn();
const loggerError = vi.fn();
vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: (...a: unknown[]) => loggerInfo(...a),
    warn: (...a: unknown[]) => loggerWarn(...a),
    error: (...a: unknown[]) => loggerError(...a),
  },
}));

// Import AFTER mocks
import { POST } from "@/app/api/auth/login/route";
import { NextRequest } from "next/server";

const APP_ORIGIN = "https://valshop.vercel.app";
const SENTINEL_PASSWORD = "SECRET_PW_SMOKE_xyz123";

function makeReq(body: unknown, opts: { origin?: string | null } = {}): NextRequest {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-forwarded-for": "1.2.3.4",
  };
  const origin = opts.origin === undefined ? APP_ORIGIN : opts.origin;
  if (origin) headers["Origin"] = origin;

  return new NextRequest("https://valshop.vercel.app/api/auth/login", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function assertNoPasswordLeak(password: string): void {
  for (const fn of [loggerInfo, loggerWarn, loggerError]) {
    for (const call of fn.mock.calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain(password);
    }
  }
}

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_ORIGIN = APP_ORIGIN;
    process.env.TOKEN_ENC_KEY = Buffer.alloc(32, "a").toString("base64");
    process.env.PENDING_ENC_KEY = Buffer.alloc(32, "b").toString("base64");
    process.env.AUTH_MODE = "credentials";

    // default: rate limit pass, session create OK
    withRateLimitMock.mockResolvedValue(null);
    createSessionMock.mockResolvedValue({
      sessionId: "00000000-1111-2222-3333-444444444444",
      maxAge: 1209600,
    });
  });

  afterEach(() => {
    delete process.env.APP_ORIGIN;
    delete process.env.AUTH_MODE;
  });

  // ------- happy path -----------------------------------------------------
  describe("Scenario: 2FA-off happy path", () => {
    it("Given 유효 자격증명, When POST, Then 200 + session cookie + PW 누수 없음", async () => {
      mswServer.use(
        http.post("https://auth.riotgames.com/api/v1/authorization", () => {
          // preflight (initAuthFlow)
          return HttpResponse.json({}, { status: 200 });
        }),
        http.put("https://auth.riotgames.com/api/v1/authorization", () => {
          return HttpResponse.json({
            type: "response",
            response: {
              parameters: {
                uri: "https://playvalorant.com/opt_in#access_token=mock-access-token&id_token=mock-id-token",
              },
            },
          });
        }),
        http.post("https://entitlements.auth.riotgames.com/api/token/v1", () => {
          return HttpResponse.json({
            entitlements_token: "mock-entitlements-jwt",
          });
        }),
      );

      const req = makeReq({ username: "tester", password: SENTINEL_PASSWORD });
      const res = await POST(req);

      expect(res.status).toBe(200);
      const setCookie = res.headers.get("set-cookie") || "";
      expect(setCookie).toContain("session=");
      expect(createSessionMock).toHaveBeenCalledOnce();

      const bodyText = await res.text();
      expect(bodyText).not.toContain(SENTINEL_PASSWORD);

      // PW smoke (B3)
      assertNoPasswordLeak(SENTINEL_PASSWORD);
    });
  });

  // ------- MFA required ---------------------------------------------------
  describe("Scenario: 2FA-on → auth_pending cookie", () => {
    it("Given MFA required 응답, When POST, Then 200 mfa_required + auth_pending cookie", async () => {
      mswServer.use(
        http.post("https://auth.riotgames.com/api/v1/authorization", () =>
          HttpResponse.json({}, { status: 200 }),
        ),
        http.put("https://auth.riotgames.com/api/v1/authorization", () => {
          return HttpResponse.json({
            type: "multifactor",
            multifactor: { email: "j***@example.com" },
          });
        }),
      );

      const req = makeReq({ username: "tester", password: SENTINEL_PASSWORD });
      const res = await POST(req);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; email_hint: string };
      expect(body.status).toBe("mfa_required");
      expect(body.email_hint).toBe("j***@example.com");

      const setCookie = res.headers.get("set-cookie") || "";
      expect(setCookie).toContain("auth_pending=");

      // session 은 만들어지지 않아야 함
      expect(createSessionMock).not.toHaveBeenCalled();
      assertNoPasswordLeak(SENTINEL_PASSWORD);
    });
  });

  // ------- Error cases ----------------------------------------------------
  describe("Scenario: invalid credentials", () => {
    it("Given Riot auth_failure, When POST, Then 401 invalid_credentials", async () => {
      mswServer.use(
        http.post("https://auth.riotgames.com/api/v1/authorization", () =>
          HttpResponse.json({}, { status: 200 }),
        ),
        http.put("https://auth.riotgames.com/api/v1/authorization", () => {
          return HttpResponse.json({
            type: "response",
            error: "auth_failure",
          });
        }),
      );

      const req = makeReq({ username: "tester", password: "wrongpw" });
      const res = await POST(req);

      expect(res.status).toBe(401);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("invalid_credentials");
    });
  });

  describe("Scenario: rate_limited from Riot", () => {
    it("Given Riot 429, When POST, Then 429 rate_limited", async () => {
      mswServer.use(
        http.post("https://auth.riotgames.com/api/v1/authorization", () =>
          HttpResponse.json({}, { status: 200 }),
        ),
        http.put("https://auth.riotgames.com/api/v1/authorization", () => {
          return HttpResponse.json({}, { status: 429 });
        }),
      );

      const req = makeReq({ username: "tester", password: "pw" });
      const res = await POST(req);

      expect(res.status).toBe(429);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("rate_limited");
    });
  });

  describe("Scenario: upstream 5xx", () => {
    it("Given Riot 500, When POST, Then 502 riot_unavailable", async () => {
      mswServer.use(
        http.post("https://auth.riotgames.com/api/v1/authorization", () =>
          HttpResponse.json({}, { status: 200 }),
        ),
        http.put("https://auth.riotgames.com/api/v1/authorization", () => {
          return HttpResponse.json({}, { status: 500 });
        }),
      );

      const req = makeReq({ username: "tester", password: "pw" });
      const res = await POST(req);

      expect(res.status).toBe(502);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("riot_unavailable");
    });
  });

  // ------- Origin validation ----------------------------------------------
  describe("Scenario: Origin guard", () => {
    it("Given evil origin, When POST, Then 403 unknown", async () => {
      const req = makeReq(
        { username: "tester", password: SENTINEL_PASSWORD },
        { origin: "https://evil.com" },
      );
      const res = await POST(req);
      expect(res.status).toBe(403);
      assertNoPasswordLeak(SENTINEL_PASSWORD);
    });

    it("Given missing Origin header, When POST, Then 403 unknown", async () => {
      const req = makeReq(
        { username: "tester", password: SENTINEL_PASSWORD },
        { origin: null },
      );
      const res = await POST(req);
      expect(res.status).toBe(403);
      assertNoPasswordLeak(SENTINEL_PASSWORD);
    });
  });
});
