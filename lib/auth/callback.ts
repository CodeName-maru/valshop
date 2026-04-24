/**
 * Auth callback logic shared between GET and hash handlers
 */

import { NextResponse } from "next/server";
import { exchangeAccessTokenForEntitlements, fetchPuuid, withTimeout } from "@/lib/riot/auth";
import { encryptSession } from "@/lib/session/crypto";
import type { SessionPayload } from "@/lib/session/types";
import { httpRiotFetcher } from "@/lib/riot/fetcher";

export interface AuthCallbackInput {
  state: string;
  accessToken: string;
  cookieState: string | null;
  baseUrl: string;
}

export type AuthErrorCode =
  | "state_mismatch"
  | "missing_token"
  | "upstream"
  | "timeout"
  | "invalid_token";

export async function handleAuthCallback(input: AuthCallbackInput): Promise<NextResponse> {
  const { state, accessToken, cookieState, baseUrl } = input;

  const redirectUrl = (path: string): string => {
    if (baseUrl) {
      return new URL(path, baseUrl).href;
    }
    return path;
  };

  if (state !== cookieState) {
    return NextResponse.redirect(redirectUrl("/login?error=state_mismatch"), 302);
  }

  let entitlementsJwt: string;
  let puuid: string;

  try {
    entitlementsJwt = await withTimeout(exchangeAccessTokenForEntitlements(accessToken, httpRiotFetcher), 3000);
    puuid = await withTimeout(fetchPuuid(accessToken, httpRiotFetcher), 3000);
  } catch (error) {
    if (error instanceof Error && error.message === "Timeout") {
      return NextResponse.redirect(redirectUrl("/login?error=timeout"), 302);
    }
    console.error("[auth/callback] Token exchange failed:", error instanceof Error ? error.name : "Unknown");
    return NextResponse.redirect(redirectUrl("/login?error=upstream"), 302);
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 3600;

  const payload: SessionPayload = {
    puuid,
    accessToken,
    entitlementsJwt,
    expiresAt,
    region: "kr",
  };

  let sessionCiphertext: string;
  try {
    sessionCiphertext = await encryptSession(payload);
  } catch (error) {
    console.error("[auth/callback] Session encryption failed:", error instanceof Error ? error.name : "Unknown");
    return NextResponse.redirect(redirectUrl("/login?error=upstream"), 302);
  }

  const response = NextResponse.redirect(redirectUrl("/dashboard"), 302);

  const maxAge = Math.max(0, expiresAt - now);
  response.cookies.set("session", sessionCiphertext, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge,
  });

  response.cookies.delete("auth_state");

  return response;
}
