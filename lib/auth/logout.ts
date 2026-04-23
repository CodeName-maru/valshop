/**
 * 로그아웃 파이프라인 핵심 로직
 * Route Handler와 테스트가 공유하는 순수 함수
 */

import { TokenVault } from "@/lib/vault/token-vault";
import { buildLogoutCookie } from "./cookie";

export interface LogoutContext {
  userId: string | null;
}

export interface LogoutResult {
  partial: boolean;
  errors: Array<{ store: string; error: string }>;
}

/**
 * 로그아웃 파이프라인 실행 함수
 * 모든 TokenStore 어댑터의 delete()를 병렬로 호출하여 파기 완전성 보장
 */
export async function runLogout(
  vault: TokenVault,
  ctx: LogoutContext
): Promise<LogoutResult> {
  const errors: Array<{ store: string; error: string }> = [];

  // MVP: vault에만 userId 기반 토큰 파기 요청
  // Phase 2에서는 여러 어댑터가 추가될 때 Promise.allSettled로 확장
  if (ctx.userId) {
    try {
      await vault.delete(ctx.userId);
    } catch (e) {
      errors.push({
        store: "TokenVault",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    partial: errors.length > 0,
    errors,
  };
}

/**
 * 로그아웃 응답용 Set-Cookie 헤더 생성
 */
export function buildLogoutHeaders(): Headers {
  const headers = new Headers();
  headers.set("Set-Cookie", buildLogoutCookie());
  return headers;
}
