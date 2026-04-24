/**
 * JWT utilities for Riot auth
 *
 * Riot access tokens are JWTs. We only need to decode the payload
 * to extract the puuid (sub claim). No signature verification is needed
 * since we trust Riot as the token issuer.
 */

/**
 * Extract puuid from Riot access token
 * @param accessToken - Riot JWT access token
 * @returns puuid from the sub claim
 * @throws {Error} if token is malformed or sub claim is missing
 */
export function extractPuuidFromAccessToken(accessToken: string): string {
  if (!accessToken || typeof accessToken !== "string") {
    throw new Error("Invalid access token: not a string");
  }

  const parts = accessToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid access token: not a JWT");
  }

  const payload = parts[1];
  if (!payload) {
    throw new Error("Invalid access token: missing payload");
  }

  try {
    // base64url decode
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const json = Buffer.from(padded, "base64").toString("utf8");
    const decoded = JSON.parse(json) as Record<string, unknown>;

    if (!decoded.sub || typeof decoded.sub !== "string") {
      throw new Error("Invalid access token: missing sub claim");
    }

    return decoded.sub;
  } catch (e) {
    if (e instanceof Error) {
      throw e;
    }
    throw new Error("Invalid access token: failed to decode payload");
  }
}
