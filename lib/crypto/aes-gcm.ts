/**
 * AES-GCM Encryption/Decryption for Token Vault
 * Server-side only (requires Node.js Web Crypto)
 */

/**
 * Encrypt data using AES-GCM
 *
 * @param plaintext - Data to encrypt
 * @param key - CryptoKey for encryption
 * @returns Base64-encoded ciphertext (with IV prepended)
 */
export async function encrypt(
  plaintext: string,
  key: CryptoKey
): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  // Generate random IV (12 bytes for GCM)
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Encrypt
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    data
  );

  // Combine IV + ciphertext and encode as base64
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return Buffer.from(combined).toString("base64");
}

/**
 * Decrypt data using AES-GCM
 *
 * @param ciphertextBase64 - Base64-encoded ciphertext (IV prepended)
 * @param key - CryptoKey for decryption
 * @returns Decrypted plaintext
 * @throws Error if decryption fails
 */
export async function decrypt(
  ciphertextBase64: string,
  key: CryptoKey
): Promise<string> {
  try {
    // Decode base64
    const combined = Buffer.from(ciphertextBase64, "base64");

    // Extract IV (first 12 bytes)
    const iv = combined.slice(0, 12);

    // Extract ciphertext
    const ciphertext = combined.slice(12);

    // Decrypt
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
      },
      key,
      ciphertext
    );

    const decoder = new TextDecoder();
    return decoder.decode(plaintext);
  } catch (error) {
    throw new Error("Decryption failed");
  }
}

/**
 * Load or create AES-GCM key from environment variable
 *
 * @param keyBase64 - Base64-encoded key (32 bytes for AES-256)
 * @returns CryptoKey for AES-GCM
 */
export async function loadKey(keyBase64: string): Promise<CryptoKey> {
  const keyData = Buffer.from(keyBase64, "base64");

  if (keyData.length !== 32) {
    throw new Error(`Invalid key length: expected 32 bytes, got ${keyData.length}`);
  }

  return await crypto.subtle.importKey(
    "raw",
    keyData,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Load encryption key from environment variable
 *
 * @returns CryptoKey for AES-GCM
 * @throws Error if TOKEN_ENC_KEY is not set
 */
export async function loadKeyFromEnv(): Promise<CryptoKey> {
  const keyBase64 = process.env.TOKEN_ENC_KEY;
  if (!keyBase64) {
    throw new Error("TOKEN_ENC_KEY environment variable is not set");
  }
  return loadKey(keyBase64);
}
