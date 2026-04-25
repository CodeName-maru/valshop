/**
 * Riot Auth Start Endpoint
 * GET /api/auth/start
 *
 * Generates a random state, sets it as a cookie, and redirects to Riot authorize URL
 */

import { NextRequest, NextResponse } from "next/server";
import { buildRiotAuthorizeUrl } from "@/lib/riot/auth";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  // Generate 32-byte random state (base64url)
  const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32)))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  // Get redirect URI from environment
  const redirectUri = process.env.RIOT_AUTH_REDIRECT_URI ?? "http://localhost:3000/api/auth/callback";

  // Build Riot authorize URL
  const riotUrl = buildRiotAuthorizeUrl(state, redirectUri);
  logger.info("auth/start redirecting", { riotUrl });

  // Set state cookie (httpOnly, Secure, SameSite=Lax, 10 min TTL)
  const response = NextResponse.redirect(riotUrl, 302);
  response.cookies.set("auth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 minutes
  });

  return response;
}
