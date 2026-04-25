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
    // 원본 에러(OperationError/TypeError/…) 를 cause 로 보존 — 진단 시 스택/이름 확인 가능.
    // 외부로 드러나는 메시지는 정보 누출 방지 위해 일반화된 문자열 유지.
    throw new Error("Decryption failed", { cause: error });
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
    throw new Error(`Invalid key length: expected 32 bytes, got ${String(keyData.length)}`);
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

/**
 * Decrypt user tokens (access_token, refresh_token, entitlements_jwt)
 *
 * @param accessTokenEnc - Base64-encoded encrypted access token
 * @param refreshTokenEnc - Base64-encoded encrypted refresh token
 * @param entitlementsJwtEnc - Base64-encoded encrypted entitlements JWT
 * @param key - CryptoKey for decryption
 * @returns Decrypted tokens
 * @throws Error if decryption fails
 */
export async function decryptTokens(
  accessTokenEnc: string,
  refreshTokenEnc: string,
  entitlementsJwtEnc: string,
  key: CryptoKey
): Promise<{
  accessToken: string;
  refreshToken: string;
  entitlementsJwt: string;
}> {
  // allSettled 로 모든 결과를 받아 실패한 토큰 라벨을 에러에 포함시킨다.
  // Promise.all 은 첫 실패만 전파하므로 어느 토큰이 깨졌는지 디버깅 불가.
  const results = await Promise.allSettled([
    decrypt(accessTokenEnc, key),
    decrypt(refreshTokenEnc, key),
    decrypt(entitlementsJwtEnc, key),
  ]);

  const labels = ["accessToken", "refreshToken", "entitlementsJwt"] as const;
  const failed = results
    .map((r, i) => (r.status === "rejected" ? labels[i] : null))
    .filter((x): x is typeof labels[number] => x !== null);

  if (failed.length > 0) {
    const first = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    throw new Error(`Decryption failed for: ${failed.join(", ")}`, { cause: first.reason });
  }

  const [accessToken, refreshToken, entitlementsJwt] = results.map(
    (r) => (r as PromiseFulfilledResult<string>).value
  );

  return { accessToken: accessToken!, refreshToken: refreshToken!, entitlementsJwt: entitlementsJwt! };
}
