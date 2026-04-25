/**
 * Plan 0021 Phase 2: MFA Route Handler
 *
 * 2단계 인증 코드 제출 엔드포인트.
 * auth_pending cookie → jar 복원 → MFA 코드 제출 → session cookie 발급
 *
 * spec § 4-3: FR-R4
 * NFR: Performance (p95 ≤ 2s), Security (위조 검증), Operability (구조화 로그)
 */

import { NextRequest, NextResponse } from "next/server";
import { RiotCookieJar } from "@/lib/riot/cookie-jar";
import { submitMfa, exchangeEntitlements } from "@/lib/riot/auth-client";
import { httpRiotFetcher } from "@/lib/riot/fetcher";
import { getSessionStore } from "@/lib/session/store";
import { decodePendingJar } from "@/lib/session/pending-jar";
import { withOrigin } from "@/lib/middleware/origin-check";
import { withRateLimit } from "@/lib/middleware/rate-limit";
import type { AuthErrorCode } from "@/lib/riot/errors";
import { extractPuuidFromIdToken } from "@/lib/session/crypto";
import { logger as realLogger } from "@/lib/logger";

// Re-export with module prefix
const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => realLogger.info(`[auth.mfa] ${msg}`, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => realLogger.warn(`[auth.mfa] ${msg}`, meta),
  error: (msg: string, meta?: Record<string, unknown>) => realLogger.error(`[auth.mfa] ${msg}`, meta),
};

/**
 * GET 요청은 405 Method Not Allowed
 */
export async function GET() {
  return NextResponse.json({ code: "unknown" as AuthErrorCode }, { status: 405 });
}

/**
 * PUT 요청은 405 Method Not Allowed
 */
export async function PUT() {
  return NextResponse.json({ code: "unknown" as AuthErrorCode }, { status: 405 });
}

/**
 * DELETE 요청은 405 Method Not Allowed
 */
export async function DELETE() {
  return NextResponse.json({ code: "unknown" as AuthErrorCode }, { status: 405 });
}

/**
 * POST /api/auth/mfa
 *
 * Request body: { code: string }
 * Request cookie: auth_pending (required)
 * Response:
 *   - 200 { ok: true } + session cookie + auth_pending cleared
 *   - 400 { code: "mfa_expired" }
 *   - 401 { code: "mfa_invalid" }
 *   - 429 { code: "rate_limited", retry_after: number }
 *   - 502 { code: "riot_unavailable" }
 *   - 500 { code: "unknown" }
 */
export async function POST(req: NextRequest) {
  const startTime = Date.now();

  // Amendment A-2: AUTH_MODE 확인 (manual-ssid면 비활성)
  const authMode = process.env.AUTH_MODE || "credentials";
  if (authMode === "manual-ssid") {
    return NextResponse.json(
      { code: "unknown" as AuthErrorCode },
      { status: 410 }
    );
  }

  // 1. Origin 검증
  const originCheck = withOrigin(req);
  if (originCheck) {
    return originCheck;
  }

  // 2. Rate-limit 검증 (10회/분)
  const rateLimitCheck = await withRateLimit(req, {
    path: "mfa",
    limit: 10,
    windowSec: 60,
  });
  if (rateLimitCheck) {
    return rateLimitCheck;
  }

  // 3. 요청 파싱
  let code: string;

  try {
    const body = await req.json();
    code = body.code;

    if (typeof code !== "string") {
      return NextResponse.json(
        { code: "mfa_invalid" as AuthErrorCode },
        { status: 401 }
      );
    }
  } catch {
    return NextResponse.json(
      { code: "mfa_invalid" as AuthErrorCode },
      { status: 401 }
    );
  }

  // 4. auth_pending cookie 확인
  const pendingBlob = req.cookies.get("auth_pending")?.value;
  if (!pendingBlob) {
    logger.warn("auth.mfa.missing_pending");
    return NextResponse.json(
      { code: "mfa_expired" as AuthErrorCode },
      { status: 400 }
    );
  }

  // 5. auth_pending 복호화
  const decoded = await decodePendingJar(pendingBlob);
  if (!decoded) {
    logger.warn("auth.mfa.invalid_pending");
    return NextResponse.json(
      { code: "mfa_expired" as AuthErrorCode },
      { status: 400 }
    );
  }

  logger.info("auth.mfa.attempt", {
    path: "/api/auth/mfa",
    ip: req.headers.get("x-forwarded-for") || "unknown",
    username: decoded.username.slice(0, 3) + "***",
  });

  // 6. jar 복원 (Plan 0021 fix B1: PendingCookie[] → tough-cookie 로 실제로 채움)
  const jar = await RiotCookieJar.fromPendingCookies(decoded.jar);

  try {
    // 7. MFA 코드 제출
    const mfaResult = await submitMfa(jar, code, httpRiotFetcher);

    switch (mfaResult.kind) {
      case "ok": {
        // 8. 토큰 획득 → 세션 생성
        logger.info("auth.mfa.success");

        // PUUID 추출
        const puuid = extractPuuidFromIdToken(mfaResult.idToken);
        if (!puuid) {
          logger.error("auth.mfa.puuid_extract_failed");
          return NextResponse.json(
            { code: "riot_unavailable" as AuthErrorCode },
            { status: 502 }
          );
        }

        // Entitlements 교환
        const entitlementsJwt = await exchangeEntitlements(
          mfaResult.accessToken,
          httpRiotFetcher
        );

        // Session store에 저장
        const store = getSessionStore();

        // jar에서 ssid/tdid 추출
        const jarJson = jar.serialize();
        const parsedJar = JSON.parse(jarJson);
        const cookies = parsedJar.cookies || [];

        const ssidCookie = cookies.find((c: any) => c.key === "ssid");
        const tdidCookie = cookies.find((c: any) => c.key === "tdid");

        const ssid = ssidCookie?.value || "";
        const tdid = tdidCookie?.value || undefined;

        const { sessionId, maxAge } = await store.createSession(puuid, {
          accessToken: mfaResult.accessToken,
          entitlementsJwt,
          ssid,
          tdid,
          region: "kr",
          accessExpiresIn: 3600,
        });

        logger.info("auth.mfa.session_created", {
          sessionId: sessionId.slice(0, 8) + "***",
          durationMs: Date.now() - startTime,
        });

        // Session cookie 설정 + auth_pending clear
        const response = NextResponse.json({ ok: true });
        response.cookies.set("session", sessionId, {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          maxAge,
          path: "/",
        });
        response.cookies.set("auth_pending", "", {
          httpOnly: true,
          secure: true,
          sameSite: "strict",
          maxAge: 0, // clear
          path: "/",
        });

        return response;
      }

      case "invalid": {
        logger.warn("auth.mfa.invalid_code");
        // auth_pending cookie는 유지 (재시도 가능)
        return NextResponse.json(
          { code: "mfa_invalid" as AuthErrorCode },
          { status: 401 }
        );
      }

      case "rate_limited": {
        logger.warn("auth.mfa.rate_limited");
        return NextResponse.json(
          { code: "rate_limited" as AuthErrorCode },
          { status: 429 }
        );
      }

      case "upstream": {
        logger.error("auth.mfa.upstream_error");
        return NextResponse.json(
          { code: "riot_unavailable" as AuthErrorCode },
          { status: 502 }
        );
      }

      default: {
        logger.error("auth.mfa.unknown_kind", { kind: (mfaResult as any).kind });
        return NextResponse.json(
          { code: "unknown" as AuthErrorCode },
          { status: 500 }
        );
      }
    }
  } catch (e) {
    logger.error("auth.mfa.unexpected", {
      err: e instanceof Error ? e.message : "unknown",
    });

    return NextResponse.json(
      { code: "unknown" as AuthErrorCode },
      { status: 500 }
    );
  }
}
