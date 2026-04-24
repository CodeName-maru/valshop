/**
 * Riot HTTP 클라이언트 포트
 *
 * 재시도 정책이 포함된 HTTP 래퍼입니다.
 * - 5xx: 재시도 없음
 * - 429: 최대 1회 재시도 (Retry-After 존중, jitter 포함)
 * - 전체 윈도우 < 10s
 */

import type { RiotError } from "./errors";
import { classifyRiotResponse } from "./errors";

export interface RiotRequest {
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
}

export interface RiotFetcher {
  call<T>(req: RiotRequest): Promise<T>;
}

const MAX_429_RETRIES = 1;

interface Deps {
  sleep?: (ms: number) => Promise<void>;
}

export function createRiotFetcher(deps: Deps = {}): RiotFetcher {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  return {
    async call<T>(req: RiotRequest): Promise<T> {
      const method = req.method ?? "GET";
      const headers = req.headers ?? {};

      let attempt = 0;
      let lastError: RiotError | null = null;

      while (attempt <= MAX_429_RETRIES) {
        const response = await globalThis.fetch(req.url, {
          method,
          headers,
          ...(req.body !== undefined && { body: req.body }),
        });

        const error = await classifyRiotResponse(response);
        if (!error) {
          // 성공
          return response.json() as Promise<T>;
        }

        lastError = error;

        // 429 만 재시도
        if (error.code === "RATE_LIMITED" && attempt < MAX_429_RETRIES) {
          const waitMs = error.retryAfterMs;
          await sleepWithJitter(sleep, waitMs, attempt);
          attempt++;
          continue;
        }

        // 그 외 에러는 즉시 throw
        throw error;
      }

      // 여기 도달하면 429 재시도 실패
      throw lastError;
    },
  };
}

/**
 * jitter 를 포함한 대기 함수
 * baseMs * 2^attempt + rand(0, 100ms)
 */
async function sleepWithJitter(
  sleep: (ms: number) => Promise<void>,
  baseMs: number,
  attempt: number,
): Promise<void> {
  const exponentialBackoff = baseMs * Math.pow(2, attempt);
  const jitter = Math.random() * 100; // 0~100ms
  const waitMs = exponentialBackoff + jitter;
  await sleep(waitMs);
}
