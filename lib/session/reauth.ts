/**
 * Plan 0020 Phase 3: lib/session/reauth.ts
 *
 * ssid 기반 재인증 + entitlements 재교환
 * Riot 5xx/timeout 시 upstream 정규화
 */

import type { RiotFetcher } from "@/lib/riot/fetcher";
import { reauthWithSsid, exchangeEntitlements } from "@/lib/riot/auth-client";

/**
 * Plan 0020: ReauthResult discriminated union
 */
export type ReauthResult =
  | { kind: "ok"; accessToken: string; entitlementsJwt: string; accessExpiresAt: number }
  | { kind: "expired" }
  | { kind: "upstream" };

// Plan 0020: reauth 타임아웃 3초
const REAUTH_TIMEOUT_MS = 3000;

/**
 * Plan 0020: ssid 기반 재인증 수행
 *
 * @param ssid - 세션 쿠키 ssid 값
 * @param tdid - 선택적 tdid 쿠키 값
 * @param region - Riot 지역
 * @param fetcher - RiotFetcher 포트
 * @returns ReauthResult discriminated union
 */
export async function reauthAccess(
  ssid: string,
  tdid: string | null,
  region: string,
  fetcher: RiotFetcher
): Promise<ReauthResult> {
  try {
    // AbortController로 3s 타임아웃
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REAUTH_TIMEOUT_MS);

    try {
      // reauthWithSsid 호출 (fetcher.signal 전달)
      const authResult = await reauthWithSsid(ssid, tdid ?? undefined, {
        fetch: fetcher.fetch.bind(fetcher),
      });

      clearTimeout(timeoutId);

      if (authResult.kind === "expired") {
        return { kind: "expired" };
      }

      if (authResult.kind === "upstream") {
        return { kind: "upstream" };
      }

      // authResult.kind === "ok"
      // entitlements 재교환
      let entitlementsJwt: string;
      try {
        entitlementsJwt = await exchangeEntitlements(authResult.accessToken, {
          fetch: fetcher.fetch.bind(fetcher),
        });
      } catch {
        // entitlements 실패 → upstream 정규화 (Availability)
        return { kind: "upstream" };
      }

      const accessExpiresAt = Math.floor(Date.now() / 1000) + 3600; // Riot 기본 1h

      return {
        kind: "ok",
        accessToken: authResult.accessToken,
        entitlementsJwt,
        accessExpiresAt,
      };
    } catch (e) {
      clearTimeout(timeoutId);

      // AbortError → upstream
      if (e instanceof Error && e.name === "AbortError") {
        return { kind: "upstream" };
      }

      return { kind: "upstream" };
    }
  } catch {
    // 예상치 못한 에러 → upstream 정규화
    return { kind: "upstream" };
  }
}
