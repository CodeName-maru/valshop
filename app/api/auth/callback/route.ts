/**
 * Riot Auth Callback Endpoint
 * GET /api/auth/callback
 *
 * Handles Riot's redirect after user auth.
 * Validates state, exchanges tokens, encrypts session, redirects to dashboard.
 *
 * NOTE: This route exports handleAuthCallback for Plan 0006 to wrap with error handling.
 */

import { NextRequest, NextResponse } from "next/server";
import { exchangeAccessTokenForEntitlements, fetchPuuid, withTimeout } from "@/lib/riot/auth";
import { encryptSession } from "@/lib/crypto/aes-gcm";
import { buildSessionCookie } from "@/lib/session/cookie";
import type { SessionPayload } from "@/lib/session/types";
import { defaultRiotFetcher } from "@/lib/riot/fetcher";

/**
 * Auth callback input (for testing and Plan 0006 wrapper)
 */
export interface AuthCallbackInput {
  state: string;
  accessToken: string;
  cookieState: string | null;
  baseUrl: string;
}

/**
 * Auth callback error codes
 */
export type AuthErrorCode =
  | "state_mismatch"
  | "missing_token"
  | "upstream"
  | "timeout"
  | "invalid_token";

/**
 * Main callback handler - exported for Plan 0006 wrapper
 */
export async function handleAuthCallback(input: AuthCallbackInput): Promise<NextResponse> {
  const { state, accessToken, cookieState, baseUrl } = input;

  // Helper for redirects (handles empty baseUrl in tests)
  const redirectUrl = (path: string): string => {
    if (baseUrl) {
      return new URL(path, baseUrl).href;
    }
    // For tests, return path as-is (next-test-api-route-handler handles relative URLs)
    return path;
  };

  // 1. Validate state
  if (state !== cookieState) {
    return NextResponse.redirect(redirectUrl("/login?error=state_mismatch"), 302);
  }

  // 2. Exchange tokens with Riot (with 3s timeout)
  let entitlementsJwt: string;
  let puuid: string;

  try {
    entitlementsJwt = await withTimeout(exchangeAccessTokenForEntitlements(accessToken, defaultRiotFetcher), 3000);
    puuid = await withTimeout(fetchPuuid(accessToken, defaultRiotFetcher), 3000);
  } catch (error) {
    // Error type detection for logging only (no tokens in logs)
    if (error instanceof Error && error.message === "Timeout") {
      return NextResponse.redirect(redirectUrl("/login?error=timeout"), 302);
    }
    // Log error type only, not details
    console.error("[auth/callback] Token exchange failed:", error instanceof Error ? error.name : "Unknown");
    return NextResponse.redirect(redirectUrl("/login?error=upstream"), 302);
  }

  // 3. Build session payload
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 3600; // 1 hour - Riot token typically lasts ~1h

  const payload: SessionPayload = {
    puuid,
    accessToken,
    refreshToken: "", // Riot implicit grant doesn't provide refresh token
    entitlementsJwt,
    expiresAt,
    region: "kr", // Fixed for KR region only
  };

  // 4. Encrypt session payload
  const sessionCiphertext = await encryptSession(payload);

  // 5. Build response with session cookie and clear auth_state
  const response = NextResponse.redirect(redirectUrl("/dashboard"), 302);

  // Set session cookie
  const maxAge = Math.max(0, expiresAt - now);
  response.cookies.set("session", sessionCiphertext, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge,
  });

  // Clear auth_state cookie
  response.cookies.delete("auth_state");

  return response;
}

/**
 * Next.js Route Handler
 */
export async function GET(request: NextRequest) {
  // Parse query params
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const accessToken = url.searchParams.get("access_token");

  // Get cookie state - try NextRequest.cookies first, fallback to Cookie header parsing
  let cookieState = request.cookies.get("auth_state")?.value ?? null;
  if (!cookieState) {
    // Fallback: parse from Cookie header (for test compatibility)
    const cookieHeader = request.headers.get("cookie");
    if (cookieHeader) {
      const match = cookieHeader.match(/auth_state=([^;]+)/);
      if (match && match[1]) {
        cookieState = match[1];
      }
    }
  }

  // Get base URL - handle test environment
  let baseUrl = url.origin;
  if (!baseUrl || baseUrl === "null") {
    const host = request.headers.get("host") || request.headers.get("x-forwarded-host");
    if (host) {
      baseUrl = `http://${host}`;
    } else {
      baseUrl = ""; // Empty for test environment - handleAuthCallback will use relative paths
    }
  }

  // Validate required params
  if (!state || !accessToken) {
    return NextResponse.redirect(redirectWithError("missing_token", baseUrl), 302);
  }

  return handleAuthCallback({ state, accessToken, cookieState, baseUrl });
}

/**
 * Helper for error redirects in GET handler
 */
function redirectWithError(error: string, baseUrl: string): string {
  if (baseUrl) {
    return new URL(`/login?error=${error}`, baseUrl).href;
  }
  // For test environment, return path (next-test-api-route-handler handles this)
  return `/login?error=${error}`;
}
