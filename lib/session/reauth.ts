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

/**
 * Plan 0020: ssid 기반 재인증 수행
 *
 * @param ssid - 세션 쿠키 ssid 값
 * @param tdid - 선택적 tdid 쿠키 값
 * @param fetcher - RiotFetcher 포트
 * @returns ReauthResult discriminated union
 */
export async function reauthAccess(
  ssid: string,
  tdid: string | null,
  fetcher: RiotFetcher
): Promise<ReauthResult> {
  try {
    // reauthWithSsid 호출
    const authResult = await reauthWithSsid(ssid, tdid ?? undefined, fetcher);

    if (authResult.kind === "expired") {
      return { kind: "expired" };
    }

    if (authResult.kind === "upstream") {
      return { kind: "upstream" };
    }

    // 429: Cloudflare throttle 등 transient. 세션을 만료시키지 말고 upstream 으로 정규화.
    if (authResult.kind === "rate_limited") {
      return { kind: "upstream" };
    }

    // authResult.kind === "ok"
    // entitlements 재교환
    let entitlementsJwt: string;
    try {
      entitlementsJwt = await exchangeEntitlements(authResult.accessToken, fetcher);
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
  } catch {
    // 예상치 못한 에러 → upstream 정규화
    return { kind: "upstream" };
  }
}
