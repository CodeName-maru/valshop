import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Feature: .env.example 키 정합성", () => {
  const content = readFileSync(resolve(__dirname, "../../.env.example"), "utf8");

  it("given_env_example_when_파싱_then_RIOT_AUTH_REDIRECT_URI_부재", () => {
    // Given/When
    // Then: 제거 대상 키 부재
    expect(content).not.toMatch(/^RIOT_AUTH_REDIRECT_URI=/m);
  });

  it("given_env_example_when_파싱_then_PENDING_ENC_KEY_와_APP_ORIGIN_존재", () => {
    // Given/When
    // Then: 신규 키 존재 + 주석 동반
    expect(content).toMatch(/^PENDING_ENC_KEY=/m);
    expect(content).toMatch(/^APP_ORIGIN=/m);
    // 주석 동반 (키 바로 앞 줄에 # 로 시작하는 설명)
    // PENDING_ENC_KEY 주석 확인
    expect(content).toMatch(/#[^\n]*AES-GCM encryption key for MFA pending/);
    // APP_ORIGIN 주석 확인
    expect(content).toMatch(/#[^\n]*Application origin for CSRF/);
  });

  it("given_env_example_when_TOKEN_ENC_KEY_확인_then_여전히_존재", () => {
    // Given: 0018/0019 에서 추가된 키는 유지
    expect(content).toMatch(/^TOKEN_ENC_KEY=/m);
  });

  it("given_env_example_when_α_prime_env_keys_확인_then_RIOT_CLIENT_USER_AGENT와_AUTH_MODE_존재", () => {
    // Given: Amendment A 추가 env
    // Then: α' 키 존재
    expect(content).toMatch(/^RIOT_CLIENT_USER_AGENT=/m);
    expect(content).toMatch(/^AUTH_MODE=/m);
  });
});
