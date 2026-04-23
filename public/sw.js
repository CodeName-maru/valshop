/**
 * VAL-Shop Service Worker
 *
 * App shell precache + NetworkFirst for API + CacheFirst for static assets
 * 토큰 응답은 캐시하지 않음 (Security NFR)
 */

const CACHE_VERSION = "v1";
const CACHE_NAME = `valshop-${CACHE_VERSION}`;

// App shell 페이지 (precache 대상)
const APP_SHELL_URLS = ["/", "/dashboard", "/login", "/offline", "/manifest.webmanifest"];

// 설치: app shell precache
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_URLS))
  );
  self.skipWaiting();
});

// 활성화: 오래된 캐시 정리
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("valshop-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: 캐시 전략 적용
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API 인증 경로는 캐시하지 않음 (Security NFR)
  if (url.pathname.startsWith("/api/auth/")) {
    return;
  }

  // API 요청: NetworkFirst
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request));
    return;
  }

  // 정적 자원: CacheFirst
  if (url.pathname.match(/^\/(_next\/static|icons)\//)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 기본: NetworkFirst
  event.respondWith(networkFirst(request));
});

/**
 * NetworkFirst 전략: 네트워크 우선, 실패 시 캐시
 */
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    // 성공 시 캐시 저장 (API 응답만)
    if (request.url.includes("/api/")) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    throw new Error("Network request failed and no cache available");
  }
}

/**
 * CacheFirst 전략: 캐시 우선, 없으면 네트워크
 */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  cache.put(request, response.clone());
  return response;
}
