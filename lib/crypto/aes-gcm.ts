/**
 * AES-GCM Encryption/Decryption for Session Tokens
 * NOTE: This is owned by Plan 0002. This is a temporary stub for Plan 0001 to proceed.
 * Plan 0002 will replace this with the full implementation.
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
