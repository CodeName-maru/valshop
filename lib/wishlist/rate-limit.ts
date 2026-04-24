/**
 * Wishlist Rate Limit (in-memory token bucket, best-effort)
 *
 * Plan 0016 — Cost NFR: Vercel 무료 티어 보호.
 * - 단일 인스턴스 한정. multi-region 에서 완벽 보장 X (의도된 trade-off).
 * - userId 기준, 'write' kind 에 대해 10 req/sec.
 */

const CAPACITY = 10;
const REFILL_PER_SEC = 10;

interface Bucket {
  tokens: number;
  updatedAt: number; // ms
}

const buckets = new Map<string, Bucket>();

function key(userId: string, kind: string): string {
  return `${kind}:${userId}`;
}

/**
 * 토큰 1개를 소비하려 시도. 성공 시 true, 한도 초과면 false.
 */
export function tryConsume(userId: string, kind: "write" = "write"): boolean {
  const k = key(userId, kind);
  const now = Date.now();
  const bucket = buckets.get(k);
  if (!bucket) {
    buckets.set(k, { tokens: CAPACITY - 1, updatedAt: now });
    return true;
  }
  const elapsed = (now - bucket.updatedAt) / 1000;
  bucket.tokens = Math.min(CAPACITY, bucket.tokens + elapsed * REFILL_PER_SEC);
  bucket.updatedAt = now;
  if (bucket.tokens < 1) {
    return false;
  }
  bucket.tokens -= 1;
  return true;
}

/** 테스트용 — 모든 버킷 초기화 */
export function _resetRateLimit(): void {
  buckets.clear();
}
