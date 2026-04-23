/**
 * Riot Auth Callback Hash Endpoint
 * POST /api/auth/callback/hash
 *
 * Handles fragment-based token delivery (browser JS stub posts hash here)
 * Shares logic with GET callback via handleAuthCallback
 */

import { NextRequest, NextResponse } from "next/server";
import { handleAuthCallback } from "../route";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { state, access_token } = body;

    if (!state || !access_token) {
      return NextResponse.json({ ok: false, error: "missing_params" }, { status: 400 });
    }

    const cookieState = request.cookies.get("auth_state")?.value ?? null;
    const baseUrl = request.nextUrl.origin;

    // Reuse callback handler (returns 302, but we'll override for JSON response)
    const callbackResponse = await handleAuthCallback({ state, accessToken: access_token, cookieState, baseUrl });

    // Extract redirect location from 302 response
    const location = callbackResponse.headers.get("location");

    // For POST handler, return JSON instead of redirect
    // Browser JS will handle the actual redirect
    return NextResponse.json({
      ok: true,
      redirect: location ?? "/dashboard",
    });
  } catch {
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
