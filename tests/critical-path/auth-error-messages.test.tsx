import { describe, it, expect } from "vitest";
import {
  AUTH_ERROR_MESSAGES,
  NETWORK_ERROR_MESSAGE,
} from "@/app/(app)/login/error-messages";

describe("AUTH_ERROR_MESSAGES", () => {
  it.each([
    ["invalid_credentials", /계정 정보/],
    ["mfa_required", /^$/], // 빈 문자열 (상태 전이 트리거)
    ["mfa_invalid", /인증 코드가 올바르지 않/],
    ["mfa_expired", /세션.*만료|처음부터/],
    ["rate_limited", /요청이 너무 많|잠시 후/],
    ["riot_unavailable", /라이엇.*서버|일시적/],
    ["session_expired", /세션.*만료|다시 로그인/],
    ["unknown", /알 수 없는|다시 시도/],
  ])(
    "givenAuthErrorCode_%s_whenLookedUp_thenKoreanMessageReturned",
    (code, pattern) => {
      expect(
        AUTH_ERROR_MESSAGES[code as keyof typeof AUTH_ERROR_MESSAGES]
      ).toMatch(pattern);
    }
  );

  it("givenNetworkErrorMessage_whenAccessed_thenContainsNetworkKeyword", () => {
    expect(NETWORK_ERROR_MESSAGE).toMatch(/네트워크/);
  });
});
