/**
 * Manual Token Entry (Dev Only)
 * POST /api/auth/manual
 *
 * 개발용: Riot에서 직접 받은 access_token을 입력하여 세션 생성
 *
 * Riot 토큰 얻는 방법:
 * 1. 브라우저 개발자 도구(F12) 열기
 * 2. Riot 사이트(https://riotgames.com)에서 로그인
 * 3. Application → Local Storage → https://auth.riotgames.com
 * 4. "token" 값을 복사해서 입력
 */

import { NextRequest, NextResponse } from "next/server";
import { exchangeAccessTokenForEntitlements, fetchPuuid } from "@/lib/riot/auth";
import { createRiotFetcher } from "@/lib/riot/fetcher";
import { encryptSession } from "@/lib/session/crypto";
import type { SessionPayload } from "@/lib/session/types";
import { cookies } from "next/headers";

const DEFAULT_REGION = "kr";
const SESSION_TTL_HOURS = 1; // Riot access token은 1시간 유효

export async function POST(request: NextRequest) {
  try {
    const { accessToken } = await request.json();

    if (!accessToken || typeof accessToken !== "string") {
      return NextResponse.json({ error: "accessToken required" }, { status: 400 });
    }

    const fetcher = createRiotFetcher();

    // PUUID 조회
    const puuid = await fetchPuuid(accessToken, fetcher);

    // Entitlements 토큰 조회
    const entitlementsJwt = await exchangeAccessTokenForEntitlements(accessToken, fetcher);

    // 세션 페이로드 생성 (만료: 1시간 후)
    const nowSec = Math.floor(Date.now() / 1000);
    const expiresAt = nowSec + SESSION_TTL_HOURS * 60 * 60;

    const payload: SessionPayload = {
      puuid,
      accessToken,
      entitlementsJwt,
      expiresAt,
      region: DEFAULT_REGION,
    };

    // 세션 쿠키 암호화
    const sessionValue = await encryptSession(payload);

    // 쿠키 설정
    const response = NextResponse.json({ success: true, redirect: "/dashboard" });
    response.cookies.set("session", sessionValue, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_HOURS * 60 * 60, // 1시간
    });

    return response;
  } catch (e) {
    console.error("[auth/manual] Error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to authenticate" },
      { status: 500 }
    );
  }
}
