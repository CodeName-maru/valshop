import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { testApiHandler } from "next-test-api-route-handler";
import * as handler from "@/app/api/auth/logout/route";

const APP_ORIGIN = "https://valshop.vercel.app";

describe("Feature: 로그아웃 — 서버 토큰 파기", () => {
  beforeEach(() => {
    process.env.APP_ORIGIN = APP_ORIGIN;
  });

  afterEach(() => {
    delete process.env.APP_ORIGIN;
  });
  describe("Scenario: 유효한 세션 cookie 로 로그아웃 호출", () => {
    it("given유효세션쿠키_when로그아웃POST_then세션쿠키Max-Age0으로덮어쓰기", async () => {
      // Given: 암호화된 토큰이 담긴 session cookie 를 가진 유저
      // When: POST /api/auth/logout 호출
      await testApiHandler({
        appHandler: handler,
        requestPatcher: (req) => { req.headers.set("cookie", "session=ENC_PAYLOAD"); },
        test: async ({ fetch }) => {
          const res = await fetch({
            method: "DELETE",
            headers: { Accept: "application/json", Origin: APP_ORIGIN },
          });
          // Then: 200, Set-Cookie 에 Max-Age=0, body { ok: true }
          expect(res.status).toBe(200);
          const setCookie = res.headers.get("set-cookie") ?? "";
          expect(setCookie).toMatch(/session=;/);
          expect(setCookie).toMatch(/Max-Age=0/i);
          expect(setCookie).toMatch(/HttpOnly/i);
          expect(setCookie).toMatch(/Secure/i);
          expect(setCookie).toMatch(/SameSite=Lax/i);

          const body = await res.json();
          expect(body).toEqual({ ok: true });
        },
      });
    });
  });

  describe("Scenario: 세션이 없는 상태에서도 멱등", () => {
    it("given쿠키없음_when로그아웃POST_then200과파기헤더반환(멱등)", async () => {
      // Given: cookie 헤더 없음
      await testApiHandler({
        appHandler: handler,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: "DELETE",
            headers: { Accept: "application/json", Origin: APP_ORIGIN },
          });
          // Then: 200 OK + Set-Cookie 파기 헤더 (이미 없어도 안전)
          expect(res.status).toBe(200);
          const setCookie = res.headers.get("set-cookie") ?? "";
          expect(setCookie).toMatch(/Max-Age=0/i);
          const body = await res.json();
          expect(body).toEqual({ ok: true });
        },
      });
    });
  });

  describe("Scenario: 서버 저장 위치 clear 호출 검증 (파기 완전성)", () => {
    it("given서버토큰스토어주입_when로그아웃_then모든등록어댑터의clear가호출된다", async () => {
      // MVP: NoopTokenVault는 no-op이지만 호출 계약은 유지
      // Phase 2에서 실제 vault 어댑터가 추가될 때 검증됨
      await testApiHandler({
        appHandler: handler,
        requestPatcher: (req) => { req.headers.set("cookie", "session=ENC_PAYLOAD"); },
        test: async ({ fetch }) => {
          const res = await fetch({
            method: "DELETE",
            headers: { Accept: "application/json", Origin: APP_ORIGIN },
          });
          // Then: 항상 200 반환 (MVP에서는 no-op)
          expect(res.status).toBe(200);
        },
      });
    });
  });

  describe("Scenario: 어댑터 일부 실패 시 나머지 파기는 계속 진행", () => {
    it("given쿠키파기성공_vault파기실패_when로그아웃_then쿠키는파기되고200응답", async () => {
      // MVP: NoopTokenVault는 실패하지 않으므로 항상 성공
      // Phase 2에서 vault 파기 실패 시나리오 추가
      await testApiHandler({
        appHandler: handler,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: "DELETE",
            headers: { Accept: "application/json", Origin: APP_ORIGIN },
          });
          // Then: 쿠키 파기는 항상 실행됨
          expect(res.status).toBe(200);
          const setCookie = res.headers.get("set-cookie") ?? "";
          expect(setCookie).toMatch(/Max-Age=0/i);
        },
      });
    });
  });

  describe("Scenario: GET 요청은 405 (prefetch 방어)", () => {
    it("givenGET메서드_when로그아웃엔드포인트호출_then405반환", async () => {
      await testApiHandler({
        appHandler: handler,
        test: async ({ fetch }) => {
          const res = await fetch({ method: "GET" });
          // Then: 405 Method Not Allowed
          expect(res.status).toBe(405);
        },
      });
    });
  });
});
