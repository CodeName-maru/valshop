import { describe, it, expect } from "vitest";
import { shouldCache, cacheStrategyFor } from "../../public/sw-strategies";

describe("Feature: Service Worker 캐시 전략", () => {
  describe("Scenario: 토큰 응답 캐시 금지", () => {
    it("Given /api/auth/callback, When 캐시 정책 조회, Then 'no-cache'", () => {
      expect(cacheStrategyFor("/api/auth/callback")).toBe("no-cache");
    });

    it("Given /api/store, When 조회, Then 'network-first'", () => {
      expect(cacheStrategyFor("/api/store")).toBe("network-first");
    });

    it("Given /icons/skin.png, When 조회, Then 'cache-first'", () => {
      expect(cacheStrategyFor("/icons/skin.png")).toBe("cache-first");
    });

    it("Given /_next/static/chunks/abc.js, When 조회, Then 'cache-first'", () => {
      expect(cacheStrategyFor("/_next/static/chunks/abc.js")).toBe("cache-first");
    });

    it("Given /dashboard, When shouldCache, Then true (app shell)", () => {
      expect(shouldCache("/dashboard")).toBe(true);
    });

    it("Given /login, When shouldCache, Then true (app shell)", () => {
      expect(shouldCache("/login")).toBe(true);
    });

    it("Given /api/auth/token, When shouldCache, Then false (API)", () => {
      expect(shouldCache("/api/auth/token")).toBe(false);
    });
  });
});
