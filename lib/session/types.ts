/**
 * Session Payload Type
 * NOTE: This is owned by Plan 0002. This is a temporary stub for Plan 0001 to proceed.
 * Plan 0002 will replace this with the full implementation.
 */

export interface SessionPayload {
  puuid: string;
  accessToken: string;
  refreshToken: string;
  entitlementsJwt: string;
  expiresAt: number; // Unix epoch seconds
  region: string;
}
