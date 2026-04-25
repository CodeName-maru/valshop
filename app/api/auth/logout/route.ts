/**
 * Plan 0021 Phase 3: Logout Route Handler
 *
 * 세션 파기 엔드포인트.
 * spec § 7: FR-R4 - DELETE 단일 진입점, session cookie 삭제 + DB row 삭제
 *
 * 기존 Plan 0005의 POST 경로는 삭제하고 DELETE로 교체합니다.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionStore } from "@/lib/session/store";
import { withOrigin } from "@/lib/middleware/origin-check";
import type { AuthErrorCode } from "@/lib/riot/errors";
import { logger as realLogger } from "@/lib/logger";

// Re-export with module prefix
const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => realLogger.info(`[auth.logout] ${msg}`, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => realLogger.warn(`[auth.logout] ${msg}`, meta),
  error: (msg: string, meta?: Record<string, unknown>) => realLogger.error(`[auth.logout] ${msg}`, meta),
};

/**
 * GET 요청은 405 Method Not Allowed
 */
export function GET() {
  return NextResponse.json({ code: "unknown" as AuthErrorCode }, { status: 405 });
}

/**
 * POST 요청은 405 Method Not Allowed (Plan 0005의 POST 경로 삭제)
 */
export function POST() {
  return NextResponse.json({ code: "unknown" as AuthErrorCode }, { status: 405 });
}

/**
 * PUT 요청은 405 Method Not Allowed
 */
export function PUT() {
  return NextResponse.json({ code: "unknown" as AuthErrorCode }, { status: 405 });
}

/**
 * DELETE /api/auth/logout
 *
 * Request cookie: session (optional)
 * Response:
 *   - 200 { ok: true } + session cookie cleared (멱등)
 */
export async function DELETE(req: NextRequest) {
  // 1. Origin 검증
  const originCheck = withOrigin(req);
  if (originCheck) {
    return originCheck;
  }

  // 2. Session ID 추출
  const sessionId = req.cookies.get("session")?.value;

  if (sessionId) {
    // 3. DB에서 세션 삭제 (실패 시에도 쿠키는 파기)
    try {
      const store = getSessionStore();
      await store.destroy(sessionId);
      logger.info("auth.logout.success", {
        sessionId: sessionId.slice(0, 8) + "***",
      });
    } catch (e) {
      // DB 삭제 실패 시 로그만 남기고 쿠키 파기는 계속
      logger.error("auth.logout.db_error", {
        err: e instanceof Error ? e.message : "unknown",
        sessionId: sessionId.slice(0, 8) + "***",
      });
    }
  } else {
    // Session 없으면 no-op 로그
    logger.info("auth.logout.no_session");
  }

  // 4. Session cookie 파기 (항상 수행)
  const response = NextResponse.json({ ok: true });
  response.cookies.set("session", "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 0, // clear
    path: "/",
  });

  return response;
}
