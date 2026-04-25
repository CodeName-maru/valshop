/**
 * Plan 0021 Amendment A-2: SSID Reauth Route
 *
 * AUTH_MODE=manual-ssid 일 때만 활성화되는 엔드포인트.
 * Riot 쿠키(ssid, tdid)를 직접 받아 세션을 생성합니다.
 *
 * spec § 11 Amendment A: α′ env + AUTH_MODE 플래그
 */

import { NextRequest, NextResponse } from "next/server";
import { reauthWithSsid, exchangeEntitlements } from "@/lib/riot/auth-client";
import { httpRiotFetcher } from "@/lib/riot/fetcher";
import { getSessionStore } from "@/lib/session/store";
import { withOrigin } from "@/lib/middleware/origin-check";
import { withRateLimit } from "@/lib/middleware/rate-limit";
import type { AuthErrorCode } from "@/lib/riot/errors";
import { logger as realLogger } from "@/lib/logger";

// Re-export with module prefix
const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => { realLogger.info(`[auth.ssid] ${msg}`, meta); },
  warn: (msg: string, meta?: Record<string, unknown>) => { realLogger.warn(`[auth.ssid] ${msg}`, meta); },
  error: (msg: string, meta?: Record<string, unknown>) => { realLogger.error(`[auth.ssid] ${msg}`, meta); },
};

/**
 * GET 요청은 405 Method Not Allowed
 */
export async function GET() {
  // AUTH_MODE 확인 (모든 메서드에 적용)
  const authMode = process.env.AUTH_MODE || "credentials";
  if (authMode !== "manual-ssid") {
    return NextResponse.json({ code: "unknown" }, { status: 404 });
  }
  return NextResponse.json({ code: "unknown" }, { status: 405 });
}

/**
 * PUT 요청은 405 Method Not Allowed
 */
export async function PUT() {
  const authMode = process.env.AUTH_MODE || "credentials";
  if (authMode !== "manual-ssid") {
    return NextResponse.json({ code: "unknown" }, { status: 404 });
  }
  return NextResponse.json({ code: "unknown" }, { status: 405 });
}

/**
 * DELETE 요청은 405 Method Not Allowed
 */
export async function DELETE() {
  const authMode = process.env.AUTH_MODE || "credentials";
  if (authMode !== "manual-ssid") {
    return NextResponse.json({ code: "unknown" }, { status: 404 });
  }
  return NextResponse.json({ code: "unknown" }, { status: 405 });
}

/**
 * POST /api/auth/ssid
 *
 * Request body: { ssid: string, tdid?: string, region?: string }
 * Response:
 *   - 200 { ok: true } + session cookie
 *   - 401 { code: "session_expired" } (ssid 만료)
 *   - 429 { code: "rate_limited", retry_after: number }
 *   - 502 { code: "riot_unavailable" }
 *   - 404 when AUTH_MODE != "manual-ssid"
 */
export async function POST(req: NextRequest) {
  // AUTH_MODE 확인
  const authMode = process.env.AUTH_MODE || "credentials";
  if (authMode !== "manual-ssid") {
    return NextResponse.json(
      { code: "unknown" },
      { status: 404 }
    );
  }

  // 1. Origin 검증
  const originCheck = withOrigin(req);
  if (originCheck) {
    return originCheck;
  }

  // 2. Rate-limit 검증 (10회/분 - login과 동일)
  const rateLimitCheck = await withRateLimit(req, {
    path: "ssid",
    limit: 10,
    windowSec: 60,
  });
  if (rateLimitCheck) {
    return rateLimitCheck;
  }

  // 3. 요청 파싱
  let ssid: string;
  let tdid: string | undefined;
  let region: string;

  try {
    const body = await req.json();
    ssid = body.ssid;
    tdid = body.tdid;
    region = body.region || "kr";

    if (typeof ssid !== "string") {
      return NextResponse.json(
        { code: "session_expired" },
        { status: 401 }
      );
    }

    if (tdid !== undefined && typeof tdid !== "string") {
      tdid = undefined;
    }
  } catch {
    return NextResponse.json(
      { code: "session_expired" },
      { status: 401 }
    );
  }

  logger.info("auth.ssid.attempt", {
    path: "/api/auth/ssid",
    ip: req.headers.get("x-forwarded-for") || "unknown",
    region,
  });

  try {
    // 4. Riot reauth
    const reauthResult = await reauthWithSsid(ssid, tdid, httpRiotFetcher);

    switch (reauthResult.kind) {
      case "ok": {
        // 5. Entitlements 교환
        logger.info("auth.ssid.reauth_ok");

        const entitlementsJwt = await exchangeEntitlements(
          reauthResult.accessToken,
          httpRiotFetcher
        );

        // 6. Session store에 저장 (PUUID는 JWT에서 추출 필요하지만
        // reauthWithSsid는 PUUID를 반환하지 않으므로, idToken에서 추출)
        const idToken = reauthResult.idToken;

        // 간단히 JWT 파싱 (서명 검증 없이 - 이미 TLS 채널)
        const parts = idToken.split(".");
        if (parts.length !== 3) {
          logger.error("auth.ssid.invalid_jwt");
          return NextResponse.json(
            { code: "riot_unavailable" },
            { status: 502 }
          );
        }

        const payloadPart = parts[1];
        if (!payloadPart) {
          logger.error("auth.ssid.invalid_jwt_payload");
          return NextResponse.json(
            { code: "riot_unavailable" },
            { status: 502 }
          );
        }

        const base64 = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
        const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
        const decoded = atob(padded);
        const payload = JSON.parse(decoded);
        const puuid = payload.sub as string;

        if (!puuid) {
          logger.error("auth.ssid.puuid_missing");
          return NextResponse.json(
            { code: "riot_unavailable" },
            { status: 502 }
          );
        }

        const store = getSessionStore();
        const sessionTokens: {
          accessToken: string;
          entitlementsJwt: string;
          ssid: string;
          region: string;
          accessExpiresIn: number;
          tdid?: string;
        } = {
          accessToken: reauthResult.accessToken,
          entitlementsJwt,
          ssid,
          region,
          accessExpiresIn: 3600,
        };

        if (tdid !== undefined) {
          sessionTokens.tdid = tdid;
        }

        const { sessionId, maxAge } = await store.createSession(puuid, sessionTokens);

        logger.info("auth.ssid.success", {
          sessionId: sessionId.slice(0, 8) + "***",
          puuid: puuid.slice(0, 8) + "***",
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

      case "expired": {
        logger.warn("auth.ssid.expired");
        return NextResponse.json(
          { code: "session_expired" },
          { status: 401 }
        );
      }

      case "upstream": {
        logger.error("auth.ssid.upstream_error");
        return NextResponse.json(
          { code: "riot_unavailable" },
          { status: 502 }
        );
      }

      default: {
        logger.error("auth.ssid.unknown_kind", { kind: (reauthResult as any).kind });
        return NextResponse.json(
          { code: "unknown" },
          { status: 500 }
        );
      }
    }
  } catch (e) {
    logger.error("auth.ssid.unexpected", {
      err: e instanceof Error ? e.message : "unknown",
    });

    return NextResponse.json(
      { code: "unknown" },
      { status: 500 }
    );
  }
}
