/**
 * Session Cookie Builder
 * NOTE: This is owned by Plan 0002. This is a temporary stub for Plan 0001 to proceed.
 * Plan 0002 will replace this with the full implementation.
 */

import type { SessionPayload } from "./types";

/**
 * Build Set-Cookie header value for session cookie
 * Max-Age is dynamically calculated from expiresAt
 */
export function buildSessionCookie(payload: SessionPayload): string {
  const maxAge = Math.max(0, payload.expiresAt - Math.floor(Date.now() / 1000));

  // Temporary stub - Plan 0002 will implement actual cookie building with encrypted payload
  const value = Buffer.from(JSON.stringify(payload)).toString("base64");

  return `session=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}
