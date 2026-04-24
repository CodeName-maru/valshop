/**
 * Riot Authentication API Client
 * Uses Plan 0006's RiotFetcher port for DI
 */

import type { RiotFetcher } from "./fetcher";

const RIOT_AUTH_BASE = "https://auth.riotgames.com";
const ENTITLEMENTS_BASE = "https://entitlements.auth.riotgames.com";

/**
 * Exchange access token for entitlements JWT
 * POST https://entitlements.auth.riotgames.com/api/token/v1
 */
export async function exchangeAccessTokenForEntitlements(
  accessToken: string,
  fetcher: RiotFetcher,
): Promise<string> {
  const response = await fetcher.fetch(`${ENTITLEMENTS_BASE}/api/token/v1`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Entitlements request failed: ${response.status}`);
  }

  const data = await response.json();
  return data.entitlements_token as string;
}

/**
 * Fetch PUUID from userinfo endpoint
 * GET https://auth.riotgames.com/userinfo
 */
export async function fetchPuuid(accessToken: string, fetcher: RiotFetcher): Promise<string> {
  const response = await fetcher.fetch(`${RIOT_AUTH_BASE}/userinfo`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Userinfo request failed: ${response.status}`);
  }

  const data = await response.json();
  return data.sub as string; // PUUID
}

/**
 * Build Riot authorize URL for implicit grant flow
 */
export function buildRiotAuthorizeUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: "play-valorant-web-prod",
    response_type: "token",
    scope: "account openid",
    state,
    redirect_uri: redirectUri,
  });

  return `${RIOT_AUTH_BASE}/authorize?${params.toString()}`;
}

/**
 * Wrap promise with timeout (3s default for Riot calls)
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number = 3000): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);

  try {
    // For fetch-based promises, we'd pass the signal
    // Since we're wrapping arbitrary promises, we race with a timeout promise
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), ms),
      ),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}
