/**
 * Riot Auth Client
 *
 * Riot 비공식 auth flow 를 호출하는 단일 책임 HTTP 어댑터.
 * Plan 0019 FR-R2 구현.
 *
 * 이 모듈은 DB/암호화/세션/쿠키 직렬화를 알지 못합니다.
 * Riot 과의 HTTP 통신만 담당합니다.
 *
 * Amendment A (α′ 계약 정정) 반영:
 * - Preflight POST → Credential PUT → MFA PUT 순서
 * - flat body 스키마 (riot_identity 중첩 제거)
 * - PUUID는 JWT decode로 취득 (/userinfo 호출 제거)
 */

import type { RiotFetcher } from "./fetcher";
import { RiotCookieJar } from "./cookie-jar";

// Constants
const RIOT_AUTH_BASE = "https://auth.riotgames.com";
const ENTITLEMENTS_BASE = "https://entitlements.auth.riotgames.com";

// Environment variable (Amendment A-7)
const RIOT_CLIENT_USER_AGENT =
  process.env.RIOT_CLIENT_USER_AGENT ||
  "RiotClient/60.0.6.4770705.4749685 rso-auth (Windows;10;;Professional, x64)";

/**
 * Authorize query parameters (Amendment A-1, A-2)
 */
const AUTHORIZE_PARAMS = {
  client_id: "play-valorant-web-prod",
  nonce: "1",
  redirect_uri: "https://playvalorant.com/opt_in",
  response_type: "token id_token",
  scope: "account openid",
};

/**
 * Preflight body (Amendment A-1)
 */
const PREFLIGHT_BODY = {
  client_id: "play-valorant-web-prod",
  nonce: "1",
  redirect_uri: "https://playvalorant.com/opt_in",
  response_type: "token id_token",
  scope: "account openid",
};

/**
 * Result types for discriminated union returns
 */

export type CredentialResult =
  | { kind: "ok"; accessToken: string; idToken: string }
  | { kind: "mfa"; emailHint: string }
  | { kind: "invalid" }
  | { kind: "rate_limited" }
  | { kind: "upstream" };

export type MfaResult =
  | { kind: "ok"; accessToken: string; idToken: string }
  | { kind: "invalid" }
  | { kind: "rate_limited" }
  | { kind: "upstream" };

export type ReauthResult =
  | { kind: "ok"; accessToken: string; idToken: string }
  | { kind: "expired" }
  | { kind: "upstream" };

/**
 * withAbortSignal - 3s 타임아웃 AbortSignal 생성
 * (NFR Performance: 각 호출 3s timeout)
 */
function withAbortSignal(ms: number = 3000): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeoutId),
  };
}

/**
 * buildAuthorizeUrl - authorize URL 구성 (내부용)
 */
function buildAuthorizeUrl(): string {
  const params = new URLSearchParams({
    client_id: AUTHORIZE_PARAMS.client_id,
    nonce: AUTHORIZE_PARAMS.nonce,
    redirect_uri: AUTHORIZE_PARAMS.redirect_uri,
    response_type: AUTHORIZE_PARAMS.response_type,
    scope: AUTHORIZE_PARAMS.scope,
  });
  return `${RIOT_AUTH_BASE}/authorize?${params.toString()}`;
}

/**
 * buildReauthUrl - reauth용 authorize URL (prompt=none 추가)
 */
function buildReauthUrl(): string {
  const params = new URLSearchParams({
    ...AUTHORIZE_PARAMS,
    prompt: "none",
  });
  return `${RIOT_AUTH_BASE}/authorize?${params.toString()}`;
}

/**
 * extractAccessTokenFromUri - fragment에서 access_token 추출
 * (Amendment A-3)
 */
function extractTokensFromUri(uri: string): { accessToken: string; idToken: string } | null {
  try {
    const fragment = uri.split("#")[1];
    if (!fragment) {
      return null;
    }

    const params = new URLSearchParams(fragment);
    const accessToken = params.get("access_token");
    const idToken = params.get("id_token");

    if (!accessToken) {
      return null;
    }

    return { accessToken, idToken: idToken || "" };
  } catch {
    return null;
  }
}

/**
 * initAuthFlow - Preflight POST 요청으로 jar에 쿠키 축적
 * (Amendment A-1: POST, not GET)
 *
 * @param jar - CookieJar 인스턴스
 * @param fetcher - RiotFetcher 포트
 */
export async function initAuthFlow(
  jar: RiotCookieJar,
  fetcher: RiotFetcher,
): Promise<void> {
  const { signal, cleanup } = withAbortSignal(3000);

  try {
    const cookieHeader = await jar.getHeader(`${RIOT_AUTH_BASE}/api/v1/authorization`);

    const response = await fetcher.fetch(`${RIOT_AUTH_BASE}/api/v1/authorization`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": RIOT_CLIENT_USER_AGENT,
        ...(cookieHeader && { Cookie: cookieHeader }),
      },
      body: JSON.stringify(PREFLIGHT_BODY),
      signal,
    });

    // Set-Cookie 헤더를 jar에 저장
    await jar.storeFromResponse(`${RIOT_AUTH_BASE}/api/v1/authorization`, response);
  } finally {
    cleanup();
  }
}

/**
 * submitCredentials - Credential 제출 (flat body)
 * (Amendment A-2)
 *
 * @param jar - CookieJar 인스턴스
 * @param credentials - username, password
 * @param fetcher - RiotFetcher 포트
 * @returns CredentialResult discriminated union
 */
export async function submitCredentials(
  jar: RiotCookieJar,
  credentials: { username: string; password: string },
  fetcher: RiotFetcher,
): Promise<CredentialResult> {
  const { signal, cleanup } = withAbortSignal(3000);

  try {
    const cookieHeader = await jar.getHeader(`${RIOT_AUTH_BASE}/api/v1/authorization`);

    const response = await fetcher.fetch(`${RIOT_AUTH_BASE}/api/v1/authorization`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": RIOT_CLIENT_USER_AGENT,
        ...(cookieHeader && { Cookie: cookieHeader }),
      },
      body: JSON.stringify({
        type: "auth",
        username: credentials.username,
        password: credentials.password,
        remember: true,
        language: "en_US",
      }),
      signal,
    });

    // Set-Cookie 저장
    await jar.storeFromResponse(`${RIOT_AUTH_BASE}/api/v1/authorization`, response);

    // 상태 코드 기반 분류
    if (response.status === 429) {
      return { kind: "rate_limited" };
    }
    if (response.status >= 500) {
      return { kind: "upstream" };
    }

    // Body 파싱
    const body = await response.json();

    // MFA 필요 (Amendment A-4)
    if (body.type === "multifactor") {
      return {
        kind: "mfa",
        emailHint: body.multifactor?.email || "",
      };
    }

    // 인증 실패
    if (body.error === "auth_failure") {
      return { kind: "invalid" };
    }

    // 성공 (Amendment A-3)
    if (body.type === "response" && body.response?.parameters?.uri) {
      const tokens = extractTokensFromUri(body.response.parameters.uri);
      if (tokens) {
        return {
          kind: "ok",
          accessToken: tokens.accessToken,
          idToken: tokens.idToken,
        };
      }
    }

    // Rate limit body
    if (body.error === "rate_limited") {
      return { kind: "rate_limited" };
    }

    // 알 수 없는 응답
    return { kind: "invalid" };
  } catch (e) {
    // AbortError (timeout) → upstream
    if (e instanceof Error && e.name === "AbortError") {
      return { kind: "upstream" };
    }
    return { kind: "upstream" };
  } finally {
    cleanup();
  }
}

/**
 * submitMfa - MFA 코드 제출 (flat body)
 * (Amendment A-4)
 *
 * @param jar - CookieJar 인스턴스
 * @param code - 6자리 MFA 코드
 * @param fetcher - RiotFetcher 포트
 * @returns MfaResult discriminated union
 */
export async function submitMfa(
  jar: RiotCookieJar,
  code: string,
  fetcher: RiotFetcher,
): Promise<MfaResult> {
  const { signal, cleanup } = withAbortSignal(3000);

  try {
    const cookieHeader = await jar.getHeader(`${RIOT_AUTH_BASE}/api/v1/authorization`);

    const response = await fetcher.fetch(`${RIOT_AUTH_BASE}/api/v1/authorization`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": RIOT_CLIENT_USER_AGENT,
        ...(cookieHeader && { Cookie: cookieHeader }),
      },
      body: JSON.stringify({
        type: "multifactor",
        code,
        rememberDevice: true,
      }),
      signal,
    });

    // Set-Cookie 저장
    await jar.storeFromResponse(`${RIOT_AUTH_BASE}/api/v1/authorization`, response);

    // 상태 코드 기반 분류
    if (response.status === 429) {
      return { kind: "rate_limited" };
    }
    if (response.status >= 500) {
      return { kind: "upstream" };
    }

    // Body 파싱
    const body = await response.json();

    // MFA 실패
    if (
      body.type === "multifactor_attempt_failed" ||
      body.error === "multifactor_attempt_failed"
    ) {
      return { kind: "invalid" };
    }

    // 인증 실패
    if (body.error === "auth_failure") {
      return { kind: "invalid" };
    }

    // 성공
    if (body.type === "response" && body.response?.parameters?.uri) {
      const tokens = extractTokensFromUri(body.response.parameters.uri);
      if (tokens) {
        return {
          kind: "ok",
          accessToken: tokens.accessToken,
          idToken: tokens.idToken,
        };
      }
    }

    // 알 수 없는 응답
    return { kind: "invalid" };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { kind: "upstream" };
    }
    return { kind: "upstream" };
  } finally {
    cleanup();
  }
}

/**
 * reauthWithSsid - ssid로 재인증 (stateless 함수)
 * (Amendment A-5)
 *
 * 내부에서 전용 jar를 생성하며, 외부 상태를 가지지 않습니다.
 *
 * @param ssid - 세션 쿠키 ssid 값
 * @param tdid - 선택적 tdid 쿠키 값
 * @param fetcher - RiotFetcher 포트
 * @returns ReauthResult discriminated union
 */
export async function reauthWithSsid(
  ssid: string,
  tdid: string | undefined,
  fetcher: RiotFetcher,
): Promise<ReauthResult> {
  // 내부 jar 생성 (stateless)
  const jar = new RiotCookieJar();

  const { signal, cleanup } = withAbortSignal(3000);

  try {
    const url = buildReauthUrl();

    // 쿠키 헤더 구성
    const cookieValues = [`ssid=${ssid}`];
    if (tdid) {
      cookieValues.push(`tdid=${tdid}`);
    }

    const response = await fetcher.fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": RIOT_CLIENT_USER_AGENT,
        Cookie: cookieValues.join("; "),
      },
      signal,
      // redirect: "manual" equivalent - we handle Location header ourselves
    });

    // Set-Cookie 저장
    await jar.storeFromResponse(url, response);

    // 상태 코드 기반 분류
    if (response.status >= 500) {
      return { kind: "upstream" };
    }

    // 302/303 redirect → Location 헤더에서 토큰 추출
    if (response.status === 302 || response.status === 303) {
      const location = response.headers.get("Location");
      if (location) {
        const tokens = extractTokensFromUri(location);
        if (tokens && tokens.accessToken) {
          return {
            kind: "ok",
            accessToken: tokens.accessToken,
            idToken: tokens.idToken,
          };
        }
      }
    }

    // 200 OK 응답 → body 파싱
    if (response.status === 200) {
      try {
        const body = await response.json();

        // 재로그인 필요
        if (body.type === "auth" || body.error === "auth_failure") {
          return { kind: "expired" };
        }
      } catch {
        // JSON 파싱 실패 → expired
      }
    }

    // Location에 access_token 없음
    return { kind: "expired" };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { kind: "upstream" };
    }
    return { kind: "upstream" };
  } finally {
    cleanup();
  }
}

/**
 * exchangeEntitlements - access token을 entitlements JWT로 교환
 *
 * @param accessToken - Riot access token
 * @param fetcher - RiotFetcher 포트
 * @returns entitlements JWT
 */
export async function exchangeEntitlements(
  accessToken: string,
  fetcher: RiotFetcher,
): Promise<string> {
  const { signal, cleanup } = withAbortSignal(3000);

  try {
    const response = await fetcher.fetch(`${ENTITLEMENTS_BASE}/api/token/v1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      signal,
    });

    if (!response.ok) {
      throw new Error(`Entitlements request failed: ${response.status}`);
    }

    const data = await response.json();
    return data.entitlements_token as string;
  } finally {
    cleanup();
  }
}
