/**
 * Service Worker 캐시 전략
 *
 * - App shell (/dashboard, /login, /) 은 precache
 * - API (/api/*) 는 NetworkFirst (장애 시 stale 응답)
 * - 인증 관련 (/api/auth/*) 은 no-cache (Security NFR)
 * - 정적 자원 (/_next/static/*, /icons/*) 은 CacheFirst
 */

export type CacheStrategy = "network-first" | "cache-first" | "no-cache";

const API_ROUTE_PATTERN = /^\/api\//;
const AUTH_ROUTE_PATTERN = /^\/api\/auth\//;
const STATIC_PATTERN = /^\/(_next\/static|icons)\//;
const APP_SHELL_ROUTES = new Set(["/", "/dashboard", "/login", "/offline"]);

/**
 * URL 패턴에 따른 캐시 전략 반환
 */
export function cacheStrategyFor(url: string): CacheStrategy {
  if (AUTH_ROUTE_PATTERN.test(url)) {
    return "no-cache"; // 토큰 응답은 캐시하지 않음 (Security NFR)
  }
  if (API_ROUTE_PATTERN.test(url)) {
    return "network-first"; // API 요청은 네트워크 우선
  }
  if (STATIC_PATTERN.test(url)) {
    return "cache-first"; // 정적 자원은 캐시 우선
  }
  return "network-first"; // 기본값
}

/**
 * App shell 페이지 여부 확인 (precache 대상)
 */
export function shouldCache(path: string): boolean {
  return APP_SHELL_ROUTES.has(path);
}

/**
 * 캐시 버전 (업데이트 시 변경하여 precache 무효화)
 */
export const CACHE_VERSION = "v1";
export const CACHE_NAME = `valshop-${CACHE_VERSION}`;
