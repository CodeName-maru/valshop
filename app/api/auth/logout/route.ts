/**
 * POST /api/auth/logout
 * 로그아웃 엔드포인트
 *
 * - httpOnly session cookie 파기
 * - 서버측 TokenVault에서 토큰 삭제 (Phase 2)
 * - Accept 헤더에 따라 JSON 또는 302 리다이렉트 응답
 */

import { NextRequest, NextResponse } from "next/server";
import { tokenVault } from "@/lib/vault/token-vault";
import { readSessionFromCookies } from "@/lib/auth/cookie";
import { runLogout, buildLogoutHeaders } from "@/lib/auth/logout";

export async function POST(req: NextRequest) {
  const cookieHeader = req.headers.get("cookie");
  const userId = readSessionFromCookies(cookieHeader);

  // 토큰 파기 실행 (vault + 기타 어댑터)
  const result = await runLogout(tokenVault, { userId });

  // 쿠키 파기 헤더는 항상 포함 (파기 실패 시에도 로컬 파기는 계속)
  const headers = buildLogoutHeaders();

  // Accept 헤더에 따라 응답 타입 결정
  const accept = req.headers.get("accept") ?? "";

  if (accept.includes("text/html")) {
    // 브라우저 폼 POST 요청: 302 리다이렉트
    const response = NextResponse.redirect(
      new URL("/login?logout=1", req.url),
      302
    );
    response.headers.set("Set-Cookie", headers.get("Set-Cookie") ?? "");
    return response;
  }

  // fetch/API 호출: JSON 응답
  if (result.partial) {
    return NextResponse.json(
      { ok: false, error: "partial-clear-failure", errors: result.errors },
      { status: 500, headers: Object.fromEntries(headers.entries()) }
    );
  }

  return NextResponse.json(
    { ok: true },
    { headers: Object.fromEntries(headers.entries()) }
  );
}

/**
 * GET 요청은 405 Method Not Allowed
 * prefetch/crawler 방지
 */
export async function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
