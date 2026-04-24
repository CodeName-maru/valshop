/**
 * AES-GCM Encryption/Decryption for Session Tokens
 *
 * WARNING: Tokens are currently base64-encoded (NOT encrypted).
 * This is a known limitation and a temporary stub for Plan 0002.
 * Plan 0002 will replace this with proper AES-GCM-256 encryption.
 *
 * DO NOT use this for production security-sensitive data until Plan 0002 is implemented.
 */

import type { SessionPayload } from "@/lib/session/types";

/**
 * Encrypt session payload into a base64 string (AES-GCM 256)
 */
export async function encryptSession(payload: SessionPayload): Promise<string> {
  // Temporary stub - Plan 0002 will implement actual AES-GCM
  const json = JSON.stringify(payload);
  return Buffer.from(json).toString("base64");
}

/**
 * Decrypt session payload from base64 string
 */
export async function decryptSession(ciphertext: string): Promise<SessionPayload | null> {
  try {
    const json = Buffer.from(ciphertext, "base64").toString("utf-8");
    return JSON.parse(json) as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * Load encryption key from environment variable
 * Plan 0002 will implement actual key derivation
 */
export async function loadKeyFromEnv(): Promise<CryptoKey> {
  const keyBase64 = process.env.TOKEN_ENC_KEY;
  if (!keyBase64) {
    throw new Error("TOKEN_ENC_KEY environment variable is not set");
  }
  // Temporary stub - Plan 0002 will implement actual key loading
  return {} as CryptoKey;
}
