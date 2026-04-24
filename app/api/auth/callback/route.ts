/**
 * Riot Auth Callback Endpoint
 * GET /api/auth/callback
 *
 * Handles Riot's redirect after user auth.
 * Validates state, exchanges tokens, encrypts session, redirects to dashboard.
 */

import { NextRequest, NextResponse } from "next/server";
import { handleAuthCallback, type AuthCallbackInput } from "@/lib/auth/callback";

export type { AuthCallbackInput, AuthErrorCode } from "@/lib/auth/callback";

/**
 * Next.js Route Handler
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const accessToken = url.searchParams.get("access_token");

  let cookieState = request.cookies.get("auth_state")?.value ?? null;
  if (!cookieState) {
    const cookieHeader = request.headers.get("cookie");
    if (cookieHeader) {
      const match = cookieHeader.match(/auth_state=([^;]+)/);
      if (match && match[1]) {
        cookieState = match[1];
      }
    }
  }

  let baseUrl = url.origin;
  if (!baseUrl || baseUrl === "null") {
    const host = request.headers.get("host") || request.headers.get("x-forwarded-host");
    if (host) {
      baseUrl = `http://${host}`;
    } else {
      baseUrl = "";
    }
  }

  if (!state || !accessToken) {
    return NextResponse.redirect(redirectWithError("missing_token", baseUrl), 302);
  }

  return handleAuthCallback({ state, accessToken, cookieState, baseUrl });
}

function redirectWithError(error: string, baseUrl: string): string {
  if (baseUrl) {
    return new URL(`/login?error=${error}`, baseUrl).href;
  }
  return `/login?error=${error}`;
}
