/**
 * CookieJar unit tests
 * Phase 1: lib/riot/cookie-jar.ts
 */

import { describe, it, expect } from "vitest";
import { RiotCookieJar } from "@/lib/riot/cookie-jar";

describe("RiotCookieJar", () => {
  describe("Test 1-1: Set-Cookie 저장 후 헤더 조회", () => {
    it("givenEmptyJar_whenStoreSetCookieFromResponse_thenGetHeaderReturnsCookiesForSameDomain", async () => {
      // Given: 빈 CookieJar
      const jar = new RiotCookieJar();

      // When: Response { headers: { "set-cookie": "asid=abc; Domain=auth.riotgames.com; Path=/; Secure; HttpOnly" } } 를 storeFromResponse 로 주입
      const mockResponse = new Response(null, {
        headers: {
          "set-cookie": "asid=abc; Domain=auth.riotgames.com; Path=/; Secure; HttpOnly",
        },
      });

      await jar.storeFromResponse("https://auth.riotgames.com/authorize", mockResponse);

      // Then: 반환 문자열이 "asid=abc" 를 포함
      const header = await jar.getHeader("https://auth.riotgames.com/authorize");
      expect(header).toContain("asid=abc");
    });
  });

  describe("Test 1-2: 다중 Set-Cookie 누적 + 도메인 스코프 필터", () => {
    it("givenJarWithRiotCookies_whenGetHeaderForDifferentDomain_thenReturnsOnlyMatchingCookies", async () => {
      // Given: jar 에 asid(auth.riotgames.com), clid(auth.riotgames.com), tdid(auth.riotgames.com), foreign(other.com) 저장
      const jar = new RiotCookieJar();

      // Riot 도메인 쿠키 저장 (각각 별도 응답으로 저장)
      const asidResponse = new Response(null, {
        headers: {
          "set-cookie": "asid=riot-asid; Domain=auth.riotgames.com; Path=/; Secure; HttpOnly",
        },
      });
      await jar.storeFromResponse("https://auth.riotgames.com/authorize", asidResponse);

      const clidResponse = new Response(null, {
        headers: {
          "set-cookie": "clid=riot-clid; Domain=auth.riotgames.com; Path=/; Secure; HttpOnly",
        },
      });
      await jar.storeFromResponse("https://auth.riotgames.com/authorize", clidResponse);

      const tdidResponse = new Response(null, {
        headers: {
          "set-cookie": "tdid=riot-tdid; Domain=auth.riotgames.com; Path=/; Secure; HttpOnly",
        },
      });
      await jar.storeFromResponse("https://auth.riotgames.com/authorize", tdidResponse);

      // 외부 도메인 쿠키 저장
      const otherResponse = new Response(null, {
        headers: {
          "set-cookie": "foreign=value; Domain=other.com; Path=/",
        },
      });
      await jar.storeFromResponse("https://other.com/", otherResponse);

      // When: getHeader("https://auth.riotgames.com/userinfo")
      const header = await jar.getHeader("https://auth.riotgames.com/userinfo");

      // Then: asid/clid/tdid 포함, foreign 미포함
      expect(header).toContain("asid=riot-asid");
      expect(header).toContain("clid=riot-clid");
      expect(header).toContain("tdid=riot-tdid");
      expect(header).not.toContain("foreign=value");
    });
  });

  describe("Test 1-3: 만료된 쿠키 제외", () => {
    it("givenExpiredCookieInJar_whenGetHeader_thenExcludesExpiredCookie", async () => {
      // Given: Set-Cookie 에 Expires=<과거> 포함된 쿠키 저장
      const jar = new RiotCookieJar();

      // 과거 날짜 (2020-01-01)
      const pastDate = new Date("2020-01-01T00:00:00Z").toUTCString();
      const expiredResponse = new Response(null, {
        headers: {
          "set-cookie": `expired=value; Expires=${pastDate}; Domain=auth.riotgames.com`,
        },
      });
      await jar.storeFromResponse("https://auth.riotgames.com/authorize", expiredResponse);

      // 유효한 쿠키도 함께 저장
      const validResponse = new Response(null, {
        headers: {
          "set-cookie": "valid=value; Domain=auth.riotgames.com; Max-Age=3600",
        },
      });
      await jar.storeFromResponse("https://auth.riotgames.com/authorize", validResponse);

      // When: getHeader 호출
      const header = await jar.getHeader("https://auth.riotgames.com/authorize");

      // Then: 해당 쿠키 부재, 유효한 쿠키는 존재
      expect(header).not.toContain("expired=value");
      expect(header).toContain("valid=value");
    });
  });

  describe("Test 1-4: serialize/deserialize 왕복", () => {
    it("givenPopulatedJar_whenSerializeThenDeserialize_thenCookiesPreserved", async () => {
      // Given: asid/clid/tdid 가 저장된 jar
      const jar = new RiotCookieJar();

      // 각 쿠키를 별도로 저장 (실제 응답 시나리오와 유사)
      const asidResponse = new Response(null, {
        headers: {
          "set-cookie": "asid=test-asid; Domain=auth.riotgames.com; Path=/; Secure; HttpOnly",
        },
      });
      await jar.storeFromResponse("https://auth.riotgames.com/authorize", asidResponse);

      const clidResponse = new Response(null, {
        headers: {
          "set-cookie": "clid=test-clid; Domain=auth.riotgames.com; Path=/; Secure; HttpOnly",
        },
      });
      await jar.storeFromResponse("https://auth.riotgames.com/authorize", clidResponse);

      const tdidResponse = new Response(null, {
        headers: {
          "set-cookie": "tdid=test-tdid; Domain=auth.riotgames.com; Path=/; Secure; HttpOnly",
        },
      });
      await jar.storeFromResponse("https://auth.riotgames.com/authorize", tdidResponse);

      // When: const blob = jar.serialize(); const restored = RiotCookieJar.deserialize(blob);
      const blob = jar.serialize();
      const restored = RiotCookieJar.deserialize(blob);

      // Then: restored.getHeader(url) 이 원본과 동일 쿠키 문자열 반환
      const originalHeader = await jar.getHeader("https://auth.riotgames.com/authorize");
      const restoredHeader = await restored.getHeader("https://auth.riotgames.com/authorize");

      expect(restoredHeader).toBe(originalHeader);
      expect(restoredHeader).toContain("asid=test-asid");
      expect(restoredHeader).toContain("clid=test-clid");
      expect(restoredHeader).toContain("tdid=test-tdid");
    });

    it("givenEmptyJar_whenSerializeThenDeserialize_thenReturnsEmptyJar", () => {
      // Given: 빈 jar
      const jar = new RiotCookieJar();

      // When: serialize/deserialize
      const blob = jar.serialize();
      const restored = RiotCookieJar.deserialize(blob);

      // Then: 빈 jar 반환
      expect(restored).toBeInstanceOf(RiotCookieJar);
    });

    it("givenInvalidBlob_whenDeserialize_thenReturnsEmptyJar", () => {
      // When: 잘못된 blob으로 deserialize
      const restored = RiotCookieJar.deserialize("invalid-json-{");

      // Then: 빈 jar 반환 (fallback)
      expect(restored).toBeInstanceOf(RiotCookieJar);
    });
  });

  describe("Test 1-5: 두 CookieJar 독립성 (Scale NFR)", () => {
    it("givenTwoJars_whenModifiedIndependently_thenDoNotShareState", async () => {
      // Given: 두 개의 독립적인 jar
      const jar1 = new RiotCookieJar();
      const jar2 = new RiotCookieJar();

      // When: jar1 에만 쿠키 저장
      const response1 = new Response(null, {
        headers: {
          "set-cookie": "jar1=value1; Domain=auth.riotgames.com",
        },
      });
      await jar1.storeFromResponse("https://auth.riotgames.com/authorize", response1);

      // jar2 에는 다른 쿠키 저장
      const response2 = new Response(null, {
        headers: {
          "set-cookie": "jar2=value2; Domain=auth.riotgames.com",
        },
      });
      await jar2.storeFromResponse("https://auth.riotgames.com/authorize", response2);

      // Then: 각 jar는 독립적인 상태 유지
      const header1 = await jar1.getHeader("https://auth.riotgames.com/authorize");
      const header2 = await jar2.getHeader("https://auth.riotgames.com/authorize");

      expect(header1).toContain("jar1=value1");
      expect(header1).not.toContain("jar2=value2");
      expect(header2).toContain("jar2=value2");
      expect(header2).not.toContain("jar1=value1");
    });
  });
});
