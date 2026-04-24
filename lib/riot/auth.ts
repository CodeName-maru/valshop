/**
 * Riot Authentication (DEPRECATED)
 *
 * This file is kept for compatibility. All functions have been moved to:
 * - auth-client.ts: initAuthFlow, submitCredentials, submitMfa, reauthWithSsid, exchangeEntitlements
 * - jwt.ts: extractPuuidFromAccessToken (replaces fetchPuuid)
 *
 * FR-R6: buildRiotAuthorizeUrl removed (implicit grant deprecated).
 * This file will be removed in a future plan.
 */

// Re-export for backward compatibility (will be removed in FR-R6)
export {
  initAuthFlow,
  submitCredentials,
  submitMfa,
  reauthWithSsid,
  exchangeEntitlements as exchangeAccessTokenForEntitlements, // Renamed for backward compatibility
} from "./auth-client";

// fetchPuuid - now uses JWT decode, fetcher param ignored for compatibility
export async function fetchPuuid(accessToken: string, _fetcher: unknown): Promise<string> {
  const { extractPuuidFromAccessToken } = await import("./jwt");
  return extractPuuidFromAccessToken(accessToken);
}

// withTimeout utility - now internal to auth-client but keeping for compatibility
export async function withTimeout<T>(
  _promise: Promise<T>,
  _ms: number = 3000,
): Promise<T> {
  throw new Error("withTimeout is deprecated. Use auth-client functions which include timeout handling.");
}

// buildRiotAuthorizeUrl - DEPRECATED (FR-R6: implicit grant removed)
// This function is kept for temporary compatibility but should not be used.
export function buildRiotAuthorizeUrl(_state: string, _redirectUri: string): string {
  throw new Error("buildRiotAuthorizeUrl is deprecated (FR-R6). Implicit grant flow is removed.");
}

// Empty export to keep this as a module
export {};
