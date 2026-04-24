/**
 * JWT utilities unit tests
 * Phase A-8: PUUID 취득 단순화 (JWT decode)
 */

import { describe, it, expect } from "vitest";
import { extractPuuidFromAccessToken } from "@/lib/riot/jwt";

describe("extractPuuidFromAccessToken", () => {
  describe("Test A-8-1: happy path - valid JWT with sub claim", () => {
    it("givenValidAccessToken_whenExtractPuuid_thenReturnsSubClaim", () => {
      // Given: 실제 Riot access token 형식의 JWT (base64url 인코딩)
      // 실제 Riot token은 header.payload.signature 형식
      // payload: {"sub":"test-puuid-123","country":"KR","...":"..."}
      const payload = JSON.stringify({ sub: "test-puuid-123", country: "KR" });
      const base64Payload = Buffer.from(payload)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
      const fakeToken = `header.${base64Payload}.signature`;

      // When
      const puuid = extractPuuidFromAccessToken(fakeToken);

      // Then
      expect(puuid).toBe("test-puuid-123");
    });
  });

  describe("Test A-8-2: malformed JWT", () => {
    it("givenMalformedToken_whenExtractPuuid_thenThrows", () => {
      // Given: 잘못된 형식의 토큰
      const malformedTokens = [
        "not-a-jwt",
        "only.two",
        "",
        "a.b.c.d",
      ];

      // When / Then
      for (const token of malformedTokens) {
        expect(() => extractPuuidFromAccessToken(token)).toThrow();
      }
    });
  });

  describe("Test A-8-3: missing sub claim", () => {
    it("givenTokenWithoutSubClaim_whenExtractPuuid_thenThrows", () => {
      // Given: sub claim이 없는 JWT
      const payload = JSON.stringify({ country: "KR", other: "value" });
      const base64Payload = Buffer.from(payload)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
      const fakeToken = `header.${base64Payload}.signature`;

      // When / Then
      expect(() => extractPuuidFromAccessToken(fakeToken)).toThrow(
        "Invalid access token: missing sub claim",
      );
    });
  });

  describe("Test A-8-4: invalid base64", () => {
    it("givenTokenWithInvalidBase64_whenExtractPuuid_thenThrows", () => {
      // Given: base64url이 아닌 잘못된 인코딩
      const fakeToken = "header.not-valid-base64!.signature";

      // When / Then
      expect(() => extractPuuidFromAccessToken(fakeToken)).toThrow();
    });
  });
});
