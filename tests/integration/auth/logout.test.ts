/**
 * Plan 0021 Phase 3: Logout Route Tests
 *
 * spec § 7: FR-R4 - DELETE 단일 진입점, session cookie 삭제 + DB row 삭제
 *
 * Plan 0021 follow-up (PR #20 fix B2):
 * - placeholder asserts → 실제 DELETE() 호출 + 응답 검증
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const destroySessionMock = vi.fn(async () => {});

vi.mock("@/lib/session/store", () => ({
  getSessionStore: () => ({
    createSession: vi.fn(),
    destroy: destroySessionMock,
    resolve: vi.fn(),
  }),
}));

import { DELETE } from "@/app/api/auth/logout/route";
import { NextRequest } from "next/server";

const APP_ORIGIN = "https://valshop.vercel.app";

function makeReq(opts: { sessionCookie?: string; origin?: string | null } = {}): NextRequest {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const origin = opts.origin === undefined ? APP_ORIGIN : opts.origin;
  if (origin) headers["Origin"] = origin;
  if (opts.sessionCookie) {
    headers["Cookie"] = `session=${opts.sessionCookie}`;
  }

  return new NextRequest("https://valshop.vercel.app/api/auth/logout", {
    method: "DELETE",
    headers,
  });
}

describe("DELETE /api/auth/logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_ORIGIN = APP_ORIGIN;
    process.env.TOKEN_ENC_KEY = Buffer.alloc(32, "a").toString("base64");
    process.env.PENDING_ENC_KEY = Buffer.alloc(32, "b").toString("base64");
  });

  afterEach(() => {
    delete process.env.APP_ORIGIN;
  });

  describe("Scenario: logout with valid session", () => {
    it("Given 유효 session 쿠키, When DELETE, Then 200 + store.destroy 호출 + 쿠키 clear", async () => {
      const sessionId = "00000000-1111-2222-3333-444444444444";
      const req = makeReq({ sessionCookie: sessionId });
      const res = await DELETE(req);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(true);

      expect(destroySessionMock).toHaveBeenCalledWith(sessionId);

      const setCookie = res.headers.get("set-cookie") || "";
      // session cookie cleared
      expect(setCookie).toMatch(/session=;/);
      expect(setCookie.toLowerCase()).toContain("max-age=0");
    });
  });

  describe("Scenario: idempotent logout (no session cookie)", () => {
    it("Given session 쿠키 없음, When DELETE, Then 200 멱등 + 파기 헤더 유지", async () => {
      const req = makeReq();
      const res = await DELETE(req);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(true);

      // destroy 는 호출되지 않아야 함
      expect(destroySessionMock).not.toHaveBeenCalled();

      // 그래도 cookie clear 헤더는 유지
      const setCookie = res.headers.get("set-cookie") || "";
      expect(setCookie).toMatch(/session=;/);
      expect(setCookie.toLowerCase()).toContain("max-age=0");
    });
  });

  describe("Scenario: Origin guard", () => {
    it("Given evil origin, When DELETE, Then 403", async () => {
      const req = makeReq({ origin: "https://evil.com", sessionCookie: "x" });
      const res = await DELETE(req);
      expect(res.status).toBe(403);
      expect(destroySessionMock).not.toHaveBeenCalled();
    });
  });
});
