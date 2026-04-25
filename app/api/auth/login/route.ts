/**
 * Plan 0021 Phase 1: Login Route Handler
 *
 * Riot 자격증명 로그인 엔드포인트.
 * 2FA-off → session cookie 발급
 * 2FA-on → auth_pending cookie 발급
 *
 * spec § 4-5: FR-R4
 * NFR: Performance (p95 ≤ 3s), Security (PW 누수 방지), Operability (구조화 로그)
 */

import { NextRequest, NextResponse } from "next/server";
import { RiotCookieJar } from "@/lib/riot/cookie-jar";
import {
  initAuthFlow,
  submitCredentials,
  exchangeEntitlements,
} from "@/lib/riot/auth-client";
import { httpRiotFetcher } from "@/lib/riot/fetcher";
import { getSessionStore } from "@/lib/session/store";
import { encodePendingJar } from "@/lib/session/pending-jar";
import { withOrigin } from "@/lib/middleware/origin-check";
import { withRateLimit } from "@/lib/middleware/rate-limit";
import type { AuthErrorCode } from "@/lib/riot/errors";
import { decodeJwt } from "@/lib/session/crypto";
import { logger as realLogger } from "@/lib/logger";

// Re-export with module prefix
const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => realLogger.info(`[auth.login] ${msg}`, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => realLogger.warn(`[auth.login] ${msg}`, meta),
  error: (msg: string, meta?: Record<string, unknown>) => realLogger.error(`[auth.login] ${msg}`, meta),
};

/**
 * PUUID를 JWT에서 추출 (plan 0019 Amendment A-3)
 */
function extractPuuidFromIdToken(idToken: string): string | null {
  try {
    const payload = decodeJwt(idToken);
    if (payload && typeof payload === "object" && "sub" in payload) {
      return payload.sub as string;
    }
    return null;
  } catch {
    return null;
  }
}

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
 * POST /api/auth/login
 *
 * Request body: { username: string, password: string }
 * Response:
 *   - 200 { ok: true } + session cookie (2FA-off)
 *   - 200 { status: "mfa_required", email_hint: string } + auth_pending cookie (2FA-on)
 *   - 401 { code: "invalid_credentials" }
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

  // 2. Rate-limit 검증 (5회/분)
  const rateLimitCheck = await withRateLimit(req, {
    path: "login",
    limit: 5,
    windowSec: 60,
  });
  if (rateLimitCheck) {
    return rateLimitCheck;
  }

  // 3. 요청 파싱 (password는 이 스코프 밖으로 전파 금지 - ADR-0011)
  let username: string;
  let password: string;

  try {
    const body = await req.json();
    username = body.username;
    password = body.password;

    if (typeof username !== "string" || typeof password !== "string") {
      return NextResponse.json(
        { code: "invalid_credentials" as AuthErrorCode },
        { status: 401 }
      );
    }
  } catch {
    return NextResponse.json(
      { code: "invalid_credentials" as AuthErrorCode },
      { status: 401 }
    );
  }

  logger.info("auth.login.attempt", {
    path: "/api/auth/login",
    ip: req.headers.get("x-forwarded-for") || "unknown",
    username: username.slice(0, 3) + "***", // partial masking
  });

  // 4. Riot Auth Flow
  const jar = new RiotCookieJar();

  try {
    // 4-1. Preflight
    await initAuthFlow(jar, httpRiotFetcher);

    // 4-2. Credential 제출 (password는 여기서만 사용)
    const credResult = await submitCredentials(
      jar,
      { username, password },
      httpRiotFetcher
    );

    // password는 더 이상 사용하지 않음 (메모리에서 자동 정리)

    switch (credResult.kind) {
      case "ok": {
        // 5. 2FA-off: 토큰 획득 → 세션 생성
        logger.info("auth.login.credential_ok");

        // PUUID 추출 (idToken에서)
        const puuid = extractPuuidFromIdToken(credResult.idToken);
        if (!puuid) {
          logger.error("auth.login.puuid_extract_failed");
          return NextResponse.json(
            { code: "riot_unavailable" as AuthErrorCode },
            { status: 502 }
          );
        }

        // Entitlements 교환
        const entitlementsJwt = await exchangeEntitlements(
          credResult.accessToken,
          httpRiotFetcher
        );

        // Session store에 저장 (ssdid/tdid는 jar에서 추출 필요하지만,
        // plan 0019 이후로 jar는 쿠키만 보유 - ssid는 Riot이 발급한 쿠키)
        // jar에서 쿠키를 직렬화해서 auth_pending에 넣었던 것과 달리,
        // 여기서는 session store에 저장
        const store = getSessionStore();

        // jar에서 ssid/tdid 추출 (RiotCookieJar는 직렬화 가능)
        const jarJson = jar.serialize();
        const jarObj = JSON.parse(jarJson);

        // tough-cookie JSON에서 ssid/tdid 찾기
        const cookies = jarObj.cookies || [];
        const ssidCookie = cookies.find((c: any) => c.key === "ssid");
        const tdidCookie = cookies.find((c: any) => c.key === "tdid");

        const ssid = ssidCookie?.value || "";
        const tdid = tdidCookie?.value || undefined;

        const { sessionId, maxAge } = await store.createSession(puuid, {
          accessToken: credResult.accessToken,
          entitlementsJwt,
          ssid,
          tdid,
          region: "kr", // TODO: 실제 region 추출 필요
          accessExpiresIn: 3600, // TODO: 실제 만료 시간 추출 필요
        });

        logger.info("auth.login.success", {
          sessionId: sessionId.slice(0, 8) + "***",
          durationMs: Date.now() - startTime,
        });

        // Session cookie 설정
        const response = NextResponse.json({ ok: true });
        response.cookies.set("session", sessionId, {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          maxAge,
          path: "/",
        });

        return response;
      }

      case "mfa": {
        // 6. 2FA-on: auth_pending cookie 발급
        logger.info("auth.login.mfa_required", {
          emailHint: credResult.emailHint,
        });

        // jar를 직렬화하여 auth_pending에 암호화 저장
        const jarCookies: { name: string; value: string; domain?: string; path?: string }[] = [];
        const jarJson = jar.serialize();
        const jarObj = JSON.parse(jarJson);
        const cookies = jarObj.cookies || [];

        for (const cookie of cookies) {
          jarCookies.push({
            name: cookie.key,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path,
          });
        }

        const pendingBlob = await encodePendingJar(jarCookies, username);

        const response = NextResponse.json({
          status: "mfa_required",
          email_hint: credResult.emailHint,
        });

        response.cookies.set("auth_pending", pendingBlob, {
          httpOnly: true,
          secure: true,
          sameSite: "strict",
          maxAge: 600, // 10분
          path: "/",
        });

        return response;
      }

      case "invalid": {
        logger.warn("auth.login.invalid_credentials");
        return NextResponse.json(
          { code: "invalid_credentials" as AuthErrorCode },
          { status: 401 }
        );
      }

      case "rate_limited": {
        logger.warn("auth.login.rate_limited");
        return NextResponse.json(
          { code: "rate_limited" as AuthErrorCode },
          { status: 429 }
        );
      }

      case "upstream": {
        logger.error("auth.login.upstream_error");
        return NextResponse.json(
          { code: "riot_unavailable" as AuthErrorCode },
          { status: 502 }
        );
      }

      default: {
        logger.error("auth.login.unknown_kind", { kind: (credResult as any).kind });
        return NextResponse.json(
          { code: "unknown" as AuthErrorCode },
          { status: 500 }
        );
      }
    }
  } catch (e) {
    // 예상치 못한 에러
    logger.error("auth.login.unexpected", {
      err: e instanceof Error ? e.message : "unknown",
    });

    return NextResponse.json(
      { code: "unknown" as AuthErrorCode },
      { status: 500 }
    );
  }
}
