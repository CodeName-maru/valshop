/**
 * Plan 0021 Phase 4: Rate Limit Middleware
 *
 * IP 기반 rate-limiting을 Supabase `rate_limit_buckets` 테이블로 구현합니다.
 * fixed window 방식 (1분 윈도우)으로 비용 0 원칙을 따릅니다.
 *
 * spec § 6: NFR Scale + Security + Cost 0
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import type { AuthErrorCode } from "@/lib/riot/errors";
import { logger } from "@/lib/logger";

/**
 * Rate limit 옵션
 */
export interface RateLimitOptions {
  path: string;
  limit: number;
  windowSec: number;
}

/**
 * extractIp - 요청에서 IP 주소 추출
 *
 * Vercel edge 환경 기본 패턴:
 * 1. x-forwarded-for 첫 hop (프록시 체인의 원본 IP)
 * 2. x-real-ip
 * 3. fallback 127.0.0.1
 *
 * @param req - NextRequest
 * @returns client IP address
 */
export function extractIp(req: NextRequest): string {
  // x-forwarded-for: "client, proxy1, proxy2"
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const parts = forwardedFor.split(",");
    const firstPart = parts[0];
    if (firstPart) {
      const firstIp = firstPart.trim();
      if (firstIp) {
        return firstIp;
      }
    }
  }

  // x-real-ip: 단일 IP
  const realIp = req.headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }

  // 로컬 개발 fallback
  return "127.0.0.1";
}

/**
 * withRateLimit - Rate limiting 미들웨어
 *
 * @param req - NextRequest
 * @param opts - rate limit 옵션
 * @returns 통과 시 null, 초과 시 429 Response
 */
export async function withRateLimit(
  req: NextRequest,
  opts: RateLimitOptions
): Promise<NextResponse | null> {
  const ip = extractIp(req);
  const bucketKey = `${opts.path}:${ip}`;
  const now = new Date();
  const windowStart = new Date(Date.now() - opts.windowSec * 1000);

  const supabase = createServiceRoleClient();

  try {
    // 기존 row 조회
    const { data: existing, error: fetchError } = await supabase
      .from("rate_limit_buckets")
      .select("count, window_start")
      .eq("bucket_key", bucketKey)
      .maybeSingle();

    if (fetchError && fetchError.code !== "PGRST116") {
      // PGRST116는 not found, 그 외 에러는 로그 후 통과 (fail-open for availability)
      logger.warn("rate-limit DB fetch error", { code: fetchError.code, message: fetchError.message });
      return null;
    }

    if (!existing) {
      // 신규 bucket: count=1, window_start=now
      const { error: insertError } = await supabase
        .from("rate_limit_buckets")
        .insert({
          bucket_key: bucketKey,
          count: 1,
          window_start: now.toISOString(),
        });

      if (insertError) {
        logger.warn("rate-limit DB insert error", { code: insertError.code, message: insertError.message });
      }
      return null; // 통과
    }

    // 기존 bucket: 윈도우 만료 검증
    const existingWindowStart = new Date(existing.window_start);
    if (existingWindowStart < windowStart) {
      // 윈도우 만료: reset to 1
      const { error: resetError } = await supabase
        .from("rate_limit_buckets")
        .update({
          count: 1,
          window_start: now.toISOString(),
        })
        .eq("bucket_key", bucketKey);

      if (resetError) {
        logger.warn("rate-limit DB reset error", { code: resetError.code, message: resetError.message });
      }
      return null; // 통과
    }

    // 윈도우 내: count 증가
    const newCount = (existing.count as number) + 1;

    if (newCount > opts.limit) {
      // 초과: 429 반환
      const retryAfter = Math.max(
        1,
        opts.windowSec - Math.floor((now.getTime() - existingWindowStart.getTime()) / 1000)
      );

      const response = NextResponse.json(
        {
          code: "rate_limited" as AuthErrorCode,
          retry_after: retryAfter,
        },
        { status: 429 }
      );
      return response;
    }

    // 미도달: count 업데이트
    const { error: updateError } = await supabase
      .from("rate_limit_buckets")
      .update({ count: newCount })
      .eq("bucket_key", bucketKey);

    if (updateError) {
      logger.warn("rate-limit DB update error", { code: updateError.code, message: updateError.message });
    }

    return null; // 통과
  } catch (e) {
    // 예외 발생 시 fail-open (가용성 우선)
    logger.error("rate-limit unexpected error", { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
