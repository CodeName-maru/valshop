/**
 * Plan 0021 Phase 5: Origin Check Middleware
 *
 * CSRF 방어를 위해 Origin 헤더를 검증합니다.
 * SameSite 쿠키와의 이중 방어 계층을 제공합니다.
 *
 * spec § 6: fail-closed 원칙 - 환경변수 미설정 시 모든 요청 차단
 */

import { NextRequest, NextResponse } from "next/server";
import type { AuthErrorCode } from "@/lib/riot/errors";

/**
 * withOrigin - Origin 검증 미들웨어
 *
 * @param req - NextRequest
 * @returns 통과 시 null, 불일치 시 403 Response
 */
export function withOrigin(req: NextRequest): NextResponse | null {
  const origin = req.headers.get("origin");
  const appOrigin = process.env.APP_ORIGIN;

  // fail-closed: 환경변수 미설정 시 모두 차단
  if (!appOrigin) {
    const response = NextResponse.json(
      { code: "unknown" },
      { status: 403 }
    );
    return response;
  }

  // Origin 헤더가 없으면 차단 (공격 의심)
  if (!origin) {
    const response = NextResponse.json(
      { code: "unknown" },
      { status: 403 }
    );
    return response;
  }

  // Origin 불일치 시 403
  if (origin !== appOrigin) {
    const response = NextResponse.json(
      { code: "unknown" },
      { status: 403 }
    );
    return response;
  }

  // 통과
  return null;
}
